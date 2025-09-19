import { TornAPI } from '@/api/torn';
import { StorageManager } from '@/storage';

// Types for the log response
interface LogEntry {
  id: string;
  timestamp: number;
  details: {
    id: number;
    title: string;
    category: string;
  };
  data: {
    cost_total?: number;
    money_gained?: number;
    money_mugged?: number;
    deposited?: number;
    amount?: number;
    [key: string]: any;
  };
  params: {
    color?: string;
    [key: string]: any;
  };
}

interface LogResponse {
  log: LogEntry[];
  _metadata: {
    links: {
      prev?: string;
      next?: string;
    };
  };
}

interface DailyProfit {
  date: string;
  income: number;
  expenses: number;
  netProfit: number;
  transactions: TransactionSummary[];
}

interface TransactionSummary {
  type: string;
  title: string;
  amount: number;
  count: number;
  isIncome: boolean;
  isNeutral?: boolean; // For piggy bank deposits and similar transfers
}

class ProfitLogger {
  private api: TornAPI | null = null;
  private storage = new StorageManager();
  private progressCallback: ((progress: number, text: string) => void) | null =
    null;

  constructor() {
    this.initializeAPI();
  }

  private async initializeAPI() {
    const storedData = this.storage.getApiKey();
    if (storedData) {
      this.api = new TornAPI(storedData.key);
    }
  }

  setProgressCallback(callback: (progress: number, text: string) => void) {
    this.progressCallback = callback;
  }

  private updateProgress(progress: number, text: string) {
    if (this.progressCallback) {
      this.progressCallback(progress, text);
    }
  }

  /**
   * Fetch logs from the Torn API with pagination
   */
  private async fetchLogs(
    category: number,
    fromTimestamp?: number,
    toTimestamp?: number,
    limit: number = 100
  ): Promise<LogEntry[]> {
    if (!this.api) {
      throw new Error('API not initialized. Please set your API key.');
    }

    let allLogs: LogEntry[] = [];
    let currentTo = toTimestamp;
    let hasMore = true;
    let batchCount = 0;
    const maxBatches = 50; // Prevent infinite loops

    while (hasMore && batchCount < maxBatches) {
      batchCount++;
      this.updateProgress(
        (batchCount / maxBatches) * 100,
        `Fetching batch ${batchCount}... (${allLogs.length} transactions so far)`
      );

      let endpoint = `user/log?cat=${category}&limit=${limit}&sort=desc`;

      if (currentTo) {
        endpoint += `&to=${currentTo}`;
      }

      if (fromTimestamp) {
        endpoint += `&from=${fromTimestamp}`;
      }

      try {
        const response = await this.api.request<LogResponse>(endpoint);

        if (!response.log || response.log.length === 0) {
          hasMore = false;
          break;
        }

        // Filter by timestamp if we have a from timestamp
        const filteredLogs = fromTimestamp
          ? response.log.filter((log) => log.timestamp >= fromTimestamp)
          : response.log;

        allLogs.push(...filteredLogs);

        // Check if we've reached the from timestamp or if there's no more data
        const oldestLog = response.log[response.log.length - 1];
        if (fromTimestamp && oldestLog.timestamp <= fromTimestamp) {
          hasMore = false;
        } else if (!response._metadata.links.prev) {
          hasMore = false;
        } else {
          // Set the timestamp for the next batch
          currentTo = oldestLog.timestamp - 1;
        }

        // Small delay to avoid hitting rate limits
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error fetching logs for category ${category}:`, error);
        hasMore = false;
      }
    }

    return allLogs;
  }

  /**
   * Analyze profit for the specified number of days
   */
  async analyzeProfitForDays(days: number): Promise<DailyProfit[]> {
    if (!this.api) {
      throw new Error('API not initialized. Please set your API key.');
    }

    const now = Math.floor(Date.now() / 1000);
    const fromTimestamp = now - days * 24 * 60 * 60;

    this.updateProgress(10, 'Fetching money incoming logs...');

    // Fetch all money-related logs
    // Category 13: Money (general)
    // Category 14: Money outgoing
    // Category 17: Money incoming
    const [moneyLogs, outgoingLogs, incomingLogs] = await Promise.all([
      this.fetchLogs(13, fromTimestamp, now),
      this.fetchLogs(14, fromTimestamp, now),
      this.fetchLogs(17, fromTimestamp, now),
    ]);

    this.updateProgress(80, 'Processing transactions...');

    // Combine all logs
    const allLogs = [...moneyLogs, ...outgoingLogs, ...incomingLogs];

    // Sort by timestamp (newest first)
    allLogs.sort((a, b) => b.timestamp - a.timestamp);

    // Group by day and calculate profits
    const dailyProfits = this.processDailyProfits(allLogs, days);

    this.updateProgress(100, 'Analysis complete!');

    return dailyProfits;
  }

  /**
   * Process logs into daily profit summaries
   */
  private processDailyProfits(logs: LogEntry[], days: number): DailyProfit[] {
    const dailyData = new Map<
      string,
      {
        income: number;
        expenses: number;
        transactions: Map<string, TransactionSummary>;
      }
    >();

    // Initialize days
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];

      dailyData.set(dateKey, {
        income: 0,
        expenses: 0,
        transactions: new Map(),
      });
    }

    // Log arrays to capture all transaction patterns for analysis
    const allTransactionPatterns: Array<{
      title: string;
      category: string;
      amount: number;
      isIncome: boolean;
      color: string;
      data: any;
      classification: string;
    }> = [];

    const unknownTransactions: Array<{
      log: LogEntry;
      extractedAmount: number;
      classification: string;
    }> = [];

    console.log(`🔍 Starting analysis of ${logs.length} log entries...`);

    // Process each log entry
    for (const log of logs) {
      const date = new Date(log.timestamp * 1000);
      const dateKey = date.toISOString().split('T')[0];

      if (!dailyData.has(dateKey)) continue;

      const dayData = dailyData.get(dateKey)!;
      const amount = this.extractAmount(log);
      const isIncome = this.isIncomeTransaction(log);

      // Determine classification reasoning for logging
      let classification = 'unknown';
      if (amount === 0) {
        classification = 'no_amount_found';
      } else if (log.params.color === 'green') {
        classification = 'green_color_income';
      } else if (log.params.color === 'red') {
        classification = 'red_color_expense';
      } else if (log.details.title.toLowerCase().includes('sell')) {
        classification = 'title_contains_sell';
      } else if (log.details.title.toLowerCase().includes('buy')) {
        classification = 'title_contains_buy';
      } else if (log.details.category.toLowerCase().includes('incoming')) {
        classification = 'category_incoming';
      } else if (log.details.category.toLowerCase().includes('outgoing')) {
        classification = 'category_outgoing';
      } else {
        classification = 'heuristic_based';
      }

      // Log all transaction patterns for analysis
      allTransactionPatterns.push({
        title: log.details.title,
        category: log.details.category,
        amount: amount,
        isIncome: isIncome,
        color: log.params.color || 'none',
        data: log.data,
        classification: classification,
      });

      // Track transactions with no amount or unclear classification
      if (
        amount === 0 ||
        classification === 'unknown' ||
        classification === 'heuristic_based'
      ) {
        unknownTransactions.push({
          log: log,
          extractedAmount: amount,
          classification: classification,
        });
      }

      if (amount > 0) {
        const isPiggyBankDeposit = log.details.title
          .toLowerCase()
          .includes('piggy bank deposit');

        // Only count as income/expense if it's not a piggy bank deposit (neutral transaction)
        if (!isPiggyBankDeposit) {
          if (isIncome) {
            dayData.income += amount;
          } else {
            dayData.expenses += amount;
          }
        }

        // Track transaction type (show all transactions including piggy bank)
        const transactionType = isPiggyBankDeposit
          ? 'neutral'
          : isIncome
          ? 'income'
          : 'expense';
        const transactionKey = `${log.details.title}-${transactionType}`;
        if (!dayData.transactions.has(transactionKey)) {
          dayData.transactions.set(transactionKey, {
            type: log.details.category,
            title: log.details.title,
            amount: 0,
            count: 0,
            isIncome: !isPiggyBankDeposit && isIncome, // Set to false for neutral transactions
            isNeutral: isPiggyBankDeposit,
          });
        }

        const transaction = dayData.transactions.get(transactionKey)!;
        transaction.amount += amount;
        transaction.count += 1;
      }
    }

    // Convert to array format
    const result: DailyProfit[] = [];

    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      const dayData = dailyData.get(dateKey)!;

      result.push({
        date: dateKey,
        income: dayData.income,
        expenses: dayData.expenses,
        netProfit: dayData.income - dayData.expenses,
        transactions: Array.from(dayData.transactions.values()).sort(
          (a, b) => b.amount - a.amount
        ),
      });
    }

    // Comprehensive logging for analysis
    console.log('\n📊 TRANSACTION ANALYSIS REPORT');
    console.log('=====================================');

    // Group and count all transaction types
    const transactionTypeStats = new Map<
      string,
      {
        count: number;
        totalAmount: number;
        incomeCount: number;
        expenseCount: number;
        colors: Set<string>;
        categories: Set<string>;
      }
    >();

    allTransactionPatterns.forEach((pattern) => {
      const key = pattern.title;
      if (!transactionTypeStats.has(key)) {
        transactionTypeStats.set(key, {
          count: 0,
          totalAmount: 0,
          incomeCount: 0,
          expenseCount: 0,
          colors: new Set(),
          categories: new Set(),
        });
      }

      const stats = transactionTypeStats.get(key)!;
      stats.count++;
      stats.totalAmount += pattern.amount;
      if (pattern.isIncome) stats.incomeCount++;
      else stats.expenseCount++;
      stats.colors.add(pattern.color);
      stats.categories.add(pattern.category);
    });

    console.log('\n🔢 TRANSACTION TYPE SUMMARY:');
    Array.from(transactionTypeStats.entries())
      .sort((a, b) => b[1].totalAmount - a[1].totalAmount)
      .forEach(([title, stats]) => {
        console.log(`\n"${title}":`, {
          count: stats.count,
          totalAmount: `$${stats.totalAmount.toLocaleString()}`,
          income: stats.incomeCount,
          expense: stats.expenseCount,
          colors: Array.from(stats.colors),
          categories: Array.from(stats.categories),
        });
      });

    console.log('\n⚠️  UNKNOWN/UNCLEAR TRANSACTIONS:');
    console.log(
      `Found ${unknownTransactions.length} transactions needing analysis:`
    );

    // Group unknown transactions by type
    const unknownByType = new Map<string, any[]>();
    unknownTransactions.forEach((item) => {
      const key = item.log.details.title;
      if (!unknownByType.has(key)) {
        unknownByType.set(key, []);
      }
      unknownByType.get(key)!.push(item);
    });

    unknownByType.forEach((items, title) => {
      console.log(`\n"${title}" (${items.length} occurrences):`, {
        category: items[0].log.details.category,
        sampleData: items[0].log.data,
        classification: items[0].classification,
        color: items[0].log.params.color || 'none',
      });
    });

    console.log('\n💰 AMOUNT EXTRACTION PATTERNS:');
    const amountFields = new Set<string>();
    allTransactionPatterns.forEach((pattern) => {
      Object.keys(pattern.data).forEach((key) => {
        if (typeof pattern.data[key] === 'number' && pattern.data[key] > 0) {
          amountFields.add(key);
        }
      });
    });
    console.log('Fields containing amounts:', Array.from(amountFields));

    console.log('\n🎨 COLOR PATTERNS:');
    const colorStats = new Map<
      string,
      { income: number; expense: number; titles: Set<string> }
    >();
    allTransactionPatterns.forEach((pattern) => {
      const color = pattern.color || 'none';
      if (!colorStats.has(color)) {
        colorStats.set(color, { income: 0, expense: 0, titles: new Set() });
      }
      const stats = colorStats.get(color)!;
      if (pattern.isIncome) stats.income++;
      else stats.expense++;
      stats.titles.add(pattern.title);
    });

    colorStats.forEach((stats, color) => {
      console.log(`Color "${color}":`, {
        income: stats.income,
        expense: stats.expense,
        uniqueTitles: stats.titles.size,
        exampleTitles: Array.from(stats.titles).slice(0, 3),
      });
    });

    console.log('\n=====================================');
    console.log('📝 Please review the above patterns and provide feedback on:');
    console.log(
      '1. Unknown/unclear transactions that need proper classification'
    );
    console.log('2. Missing amount extraction patterns');
    console.log('3. Incorrect income/expense classifications');
    console.log('=====================================\n');

    return result.reverse(); // Show oldest first
  }

  /**
   * Extract monetary amount from a log entry
   */
  private extractAmount(log: LogEntry): number {
    const data = log.data;

    // Primary amount fields (most common)
    if (data.cost_total) return data.cost_total;
    if (data.money_gained) return data.money_gained;
    if (data.money_mugged) return data.money_mugged;

    // Casino and gambling fields
    if (data.bet_amount) return data.bet_amount;
    if (data.bet) return data.bet;
    if (data.withdrawn) return data.withdrawn;
    if (data.cost) return data.cost; // Casino lottery bet
    if (data.money) return data.money; // General money field
    if (data.won_amount) return data.won_amount; // Casino winnings
    if (data.pot) return data.pot; // Casino pot winnings

    // Mission and job rewards
    if (data.credits) return data.credits;
    if (data.pay) return data.pay;

    // Property related
    if (data.rent) return data.rent; // Property rent
    if (data.upkeep_paid) return data.upkeep_paid; // Property upkeep
    if (data.donated) return data.donated; // Church donations

    // Bounties and rewards
    if (data.bounty_reward) return data.bounty_reward;

    // Banking and deposits
    if (data.deposited) return data.deposited;
    if (data.amount) return data.amount;

    // Market and fee related
    if (data.fee) return data.fee;

    return 0;
  }

  /**
   * Determine if a transaction is income or expense based on log data
   */
  private isIncomeTransaction(log: LogEntry): boolean {
    const title = log.details.title.toLowerCase();
    const category = log.details.category.toLowerCase();
    const color = log.params.color;

    // Specific transaction type rules (override color)

    // Expenses (things you spend money on) - check these FIRST
    if (title.includes('buy') || title.includes('purchase')) return false;
    if (title.includes('bet') || title.includes('lottery bet')) return false;
    if (title.includes('casino') && title.includes('join')) return false;
    if (title.includes('casino') && title.includes('start')) return false;
    if (title.includes('casino') && title.includes('lose')) return false;
    if (title.includes('deposit') || title.includes('outgoing')) return false;
    if (title.includes('send') || title.includes('transfer')) return false;
    if (title.includes('upkeep') || title.includes('donate')) return false;
    if (title.includes('bounty place')) return false;
    if (title.includes('money send')) return false;
    if (title.includes('mug receive')) return false; // Getting mugged = losing money
    if (title.includes('education start')) return false; // Education costs money
    if (title.includes('property upgrade')) return false; // Property upgrades cost money

    // Income (things that give you money)
    if (title.includes('sell') || title.includes('sale')) return true;
    if (title.includes('win') || title.includes('withdraw')) return true;
    if (title.includes('receive') || title.includes('incoming')) return true;
    if (title.includes('gain') || title.includes('profit')) return true;
    if (title.includes('complete') && category.includes('missions'))
      return true;
    if (title.includes('pay') && !title.includes('upkeep')) return true;
    if (title.includes('rent') && title.includes('owner')) return true;
    if (title.includes('cash in')) return true;

    // Color-based classification (for unclear cases)
    if (color === 'green') return true;
    if (color === 'red') return false;

    // Category-based classification
    if (category.includes('incoming')) return true;
    if (category.includes('outgoing')) return false;

    // Default: if no color and no clear indicators, assume expense for safety
    return false;
  }

  /**
   * Make the request method available for testing
   */
  async request<T>(endpoint: string): Promise<T> {
    if (!this.api) {
      throw new Error('API not initialized');
    }
    return this.api.request<T>(endpoint);
  }
}

// UI Management
class ProfitLoggerUI {
  private profitLogger: ProfitLogger;
  private analyzeBtn: HTMLButtonElement;
  private daysInput: HTMLInputElement;
  private progressSection: HTMLElement;
  private progressFill: HTMLElement;
  private progressText: HTMLElement;
  private resultsSection: HTMLElement;
  private resultsSummary: HTMLElement;
  private profitOverview: HTMLElement;
  private transactionDetails: HTMLElement;
  private errorSection: HTMLElement;
  private errorMessage: HTMLElement;
  private retryBtn: HTMLButtonElement;

  constructor() {
    this.profitLogger = new ProfitLogger();
    this.initializeElements();
    this.bindEvents();

    this.profitLogger.setProgressCallback((progress, text) => {
      this.updateProgress(progress, text);
    });
  }

  private initializeElements() {
    this.analyzeBtn = document.getElementById(
      'analyzeBtn'
    ) as HTMLButtonElement;
    this.daysInput = document.getElementById('daysInput') as HTMLInputElement;
    this.progressSection = document.getElementById(
      'progressSection'
    ) as HTMLElement;
    this.progressFill = document.getElementById('progressFill') as HTMLElement;
    this.progressText = document.getElementById('progressText') as HTMLElement;
    this.resultsSection = document.getElementById(
      'resultsSection'
    ) as HTMLElement;
    this.resultsSummary = document.getElementById(
      'resultsSummary'
    ) as HTMLElement;
    this.profitOverview = document.getElementById(
      'profitOverview'
    ) as HTMLElement;
    this.transactionDetails = document.getElementById(
      'transactionDetails'
    ) as HTMLElement;
    this.errorSection = document.getElementById('errorSection') as HTMLElement;
    this.errorMessage = document.getElementById('errorMessage') as HTMLElement;
    this.retryBtn = document.getElementById('retryBtn') as HTMLButtonElement;
  }

  private bindEvents() {
    this.analyzeBtn.addEventListener('click', () => this.startAnalysis());
    this.retryBtn.addEventListener('click', () => this.startAnalysis());
  }

  private async startAnalysis() {
    try {
      this.hideError();
      this.hideResults();
      this.showProgress();

      const days = parseInt(this.daysInput.value) || 7;
      const results = await this.profitLogger.analyzeProfitForDays(days);

      this.hideProgress();
      this.displayResults(results);
      this.showResults();
    } catch (error) {
      this.hideProgress();
      this.showError(
        error instanceof Error ? error.message : 'An unknown error occurred'
      );
    }
  }

  private updateProgress(progress: number, text: string) {
    this.progressFill.style.width = `${progress}%`;
    this.progressText.textContent = text;
  }

  private showProgress() {
    this.progressSection.classList.remove('hidden');
    this.analyzeBtn.disabled = true;
  }

  private hideProgress() {
    this.progressSection.classList.add('hidden');
    this.analyzeBtn.disabled = false;
  }

  private showResults() {
    this.resultsSection.classList.remove('hidden');
  }

  private hideResults() {
    this.resultsSection.classList.add('hidden');
  }

  private showError(message: string) {
    this.errorMessage.textContent = message;
    this.errorSection.classList.remove('hidden');
  }

  private hideError() {
    this.errorSection.classList.add('hidden');
  }

  private displayResults(dailyProfits: DailyProfit[]) {
    // Calculate totals
    const totalIncome = dailyProfits.reduce((sum, day) => sum + day.income, 0);
    const totalExpenses = dailyProfits.reduce(
      (sum, day) => sum + day.expenses,
      0
    );
    const totalProfit = totalIncome - totalExpenses;
    const avgDailyProfit = totalProfit / dailyProfits.length;

    // Display summary
    this.resultsSummary.innerHTML = `
      <div class="summary-grid">
        <div class="summary-card income">
          <div class="summary-label">Total Income</div>
          <div class="summary-value">$${totalIncome.toLocaleString()}</div>
        </div>
        <div class="summary-card expense">
          <div class="summary-label">Total Expenses</div>
          <div class="summary-value">$${totalExpenses.toLocaleString()}</div>
        </div>
        <div class="summary-card profit ${
          totalProfit >= 0 ? 'positive' : 'negative'
        }">
          <div class="summary-label">Net Profit</div>
          <div class="summary-value">$${totalProfit.toLocaleString()}</div>
        </div>
        <div class="summary-card average">
          <div class="summary-label">Avg Daily Profit</div>
          <div class="summary-value">$${avgDailyProfit.toLocaleString()}</div>
        </div>
      </div>
    `;

    // Display daily breakdown
    this.profitOverview.innerHTML = `
      <div class="daily-breakdown">
        ${dailyProfits
          .map(
            (day) => `
          <div class="daily-item">
            <div class="daily-date">${new Date(
              day.date
            ).toLocaleDateString()}</div>
            <div class="daily-income">+$${day.income.toLocaleString()}</div>
            <div class="daily-expense">-$${day.expenses.toLocaleString()}</div>
            <div class="daily-profit ${
              day.netProfit >= 0 ? 'positive' : 'negative'
            }">
              $${day.netProfit.toLocaleString()}
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;

    // Display transaction details
    this.transactionDetails.innerHTML = `
      <div class="transaction-breakdown">
        ${dailyProfits
          .map((day) =>
            day.transactions.length > 0
              ? `
          <div class="day-transactions">
            <h4>${new Date(day.date).toLocaleDateString()}</h4>
            <div class="transactions-list">
              ${day.transactions
                .map(
                  (transaction) => `
                <div class="transaction-item ${
                  transaction.isNeutral
                    ? 'neutral'
                    : transaction.isIncome
                    ? 'income'
                    : 'expense'
                }">
                  <div class="transaction-title">${transaction.title}</div>
                  <div class="transaction-count">${transaction.count}x</div>
                  <div class="transaction-amount">
                    ${
                      transaction.isNeutral
                        ? '='
                        : transaction.isIncome
                        ? '+'
                        : '-'
                    }$${transaction.amount.toLocaleString()}
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        `
              : ''
          )
          .join('')}
      </div>
    `;
  }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new ProfitLoggerUI();
});

export { ProfitLogger, ProfitLoggerUI };
