import { TornAPI } from '@/api/torn';
import { StorageManager } from '@/storage';

// Types for items
interface TornItem {
  id: number;
  name: string;
  description: string;
  type: string;
  sub_type: string;
  is_tradable: boolean;
  value?: {
    buy_price?: number;
    sell_price?: number;
    market_price?: number;
  };
  circulation?: number;
  image?: string;
}

interface ItemsResponse {
  items: TornItem[];
  _metadata?: any;
}

interface ItemCache {
  items: { [key: number]: string }; // itemId -> itemName mapping
  lastUpdated: number;
  expiresAt: number;
}

// Item categories for fetching
const ITEM_CATEGORIES = [
  'Alcohol',
  'Armor',
  'Artifact',
  'Book',
  'Booster',
  'Candy',
  'Car',
  'Clothing',
  'Collectible',
  'Defensive',
  'Drug',
  'Energy Drink',
  'Enhancer',
  'Flower',
  'Jewelry',
  'Material',
  'Medical',
  'Melee',
  'Other',
  'Plushie',
  'Primary',
  'Secondary',
  'Special',
  'Supply Pack',
  'Temporary',
  'Tool',
  'Unused',
  'Weapon',
] as const;

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
  bazaarAnalytics?: BazaarAnalytics;
}

interface TransactionSummary {
  type: string;
  title: string;
  amount: number;
  count: number;
  isIncome: boolean;
  isNeutral?: boolean; // For piggy bank deposits and similar transfers
}

interface BazaarTransactionInfo {
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  tradingPartner: string;
  playerId?: string;
  isSale: boolean; // true = sale, false = purchase
  timestamp: number;
  originalTitle: string;
}

interface ItemAnalytics {
  itemName: string;
  totalBought: number;
  totalSold: number;
  totalQuantityBought: number;
  totalQuantitySold: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  profitMargin: number;
  netProfit: number;
  transactionCount: number;
  lastActivity: number;
}

interface TradingPartnerAnalytics {
  partnerName: string;
  playerId?: string;
  totalTransactions: number;
  totalVolume: number;
  mostTradedItem: string;
  lastTransaction: number;
}

interface BazaarAnalytics {
  totalBazaarProfit: number;
  totalBazaarVolume: number;
  totalTransactions: number;
  mostProfitableItem: string;
  bestTradingPartner: string;
  itemAnalytics: ItemAnalytics[];
  tradingPartners: TradingPartnerAnalytics[];
  bazaarTransactions: BazaarTransactionInfo[];
}

class ProfitLogger {
  private api: TornAPI | null = null;
  private storage = new StorageManager();
  private progressCallback: ((progress: number, text: string) => void) | null =
    null;
  private itemMapping: { [key: number]: string } = {}; // Cache for item ID -> name mapping
  private unknownItemIds: Set<number> = new Set(); // Track unresolved item IDs

  // Issue tracking for status indicator
  private analysisIssues = {
    unknownTransactions: 0,
    missingAmountExtractions: 0,
    incorrectClassifications: 0,
    unresolvedItemIds: 0,
  };

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
   * Get item name from ID using cached mapping
   */
  private getItemName(itemId: number): string {
    const itemName = this.itemMapping[itemId];
    if (!itemName) {
      this.unknownItemIds.add(itemId);
      return `Item #${itemId}`;
    }
    return itemName;
  }

  /**
   * Load cached item mapping from storage
   */
  private async loadItemMapping(): Promise<void> {
    try {
      const cacheKey = 'torn_items_cache';
      const cached = this.storage.getCache<ItemCache>(cacheKey);

      if (cached && cached.expiresAt > Date.now()) {
        this.itemMapping = cached.items;
        console.log(
          `📦 Loaded ${Object.keys(this.itemMapping).length} items from cache`
        );
        return;
      }

      // Cache expired or doesn't exist, fetch fresh data
      console.log('🔄 Item cache expired or missing, fetching fresh data...');
      await this.fetchAndCacheItems();
    } catch (error) {
      console.warn('Failed to load item mapping:', error);
      // Continue without item mapping - will show Item #123 format
    }
  }

  /**
   * Fetch all items from Torn API and cache them
   */
  private async fetchAndCacheItems(): Promise<void> {
    if (!this.api) {
      throw new Error('API not initialized');
    }

    try {
      this.updateProgress(5, 'Fetching item data...');

      const newMapping: { [key: number]: string } = {};
      let fetchedCount = 0;

      // Fetch items in batches by category for better performance
      for (let i = 0; i < ITEM_CATEGORIES.length; i++) {
        const category = ITEM_CATEGORIES[i];
        const progress = 5 + (i / ITEM_CATEGORIES.length) * 15; // 5-20% progress

        this.updateProgress(progress, `Fetching ${category} items...`);

        try {
          const response = await this.api.request<ItemsResponse>(
            `torn/items?cat=${category}`
          );

          if (response.items && Array.isArray(response.items)) {
            response.items.forEach((item: TornItem) => {
              newMapping[item.id] = item.name;
            });
            fetchedCount += response.items.length;
          }

          // Small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          console.warn(`Failed to fetch ${category} items:`, error);
          // Continue with other categories
        }
      }

      this.itemMapping = newMapping;

      // Cache the results (expire after 24 hours)
      const cache: ItemCache = {
        items: newMapping,
        lastUpdated: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      };

      this.storage.setCache('torn_items_cache', cache, 24 * 60 * 60 * 1000); // 24 hours

      console.log(
        `✅ Fetched and cached ${fetchedCount} items from ${ITEM_CATEGORIES.length} categories`
      );
      this.updateProgress(20, `Loaded ${fetchedCount} items`);
    } catch (error) {
      console.error('Failed to fetch items:', error);
      throw new Error('Failed to fetch item data from Torn API');
    }
  }

  /**
   * Analyze profit for the specified number of days
   */
  async analyzeProfitForDays(days: number): Promise<DailyProfit[]> {
    if (!this.api) {
      throw new Error('API not initialized. Please set your API key.');
    }

    // Load item mapping first for better bazaar analytics
    await this.loadItemMapping();

    // Clear unknown item IDs from previous analysis
    this.unknownItemIds.clear();

    // Reset issue tracking
    this.analysisIssues = {
      unknownTransactions: 0,
      missingAmountExtractions: 0,
      incorrectClassifications: 0,
      unresolvedItemIds: 0,
    };

    const now = Math.floor(Date.now() / 1000);
    const fromTimestamp = now - days * 24 * 60 * 60;

    this.updateProgress(25, 'Fetching money logs...');

    // Fetch all money-related logs
    // Category 13: Money (general)
    // Category 14: Money outgoing
    // Category 17: Money incoming
    console.log('🔍 FETCHING LOGS FROM MULTIPLE CATEGORIES');
    console.log(
      `📅 Time range: ${new Date(
        fromTimestamp * 1000
      ).toISOString()} to ${new Date(now * 1000).toISOString()}`
    );

    const [moneyLogs, outgoingLogs, incomingLogs] = await Promise.all([
      this.fetchLogs(13, fromTimestamp, now),
      this.fetchLogs(14, fromTimestamp, now),
      this.fetchLogs(17, fromTimestamp, now),
    ]);

    console.log(`📊 FETCH RESULTS:`);
    console.log(
      `- Category 13 (Money general): ${moneyLogs.length} transactions`
    );
    console.log(
      `- Category 14 (Money outgoing): ${outgoingLogs.length} transactions`
    );
    console.log(
      `- Category 17 (Money incoming): ${incomingLogs.length} transactions`
    );

    // Show sample transactions from each category
    console.log(`\n📋 SAMPLE TRANSACTIONS BY CATEGORY:`);

    if (moneyLogs.length > 0) {
      console.log(`\n🔸 Category 13 (Money general) samples:`);
      moneyLogs.slice(0, 5).forEach((log, i) => {
        const amount = this.extractAmount ? this.extractAmount(log) : 0;
        console.log(
          `  ${i + 1}. ID: ${log.id}, Title: "${
            log.details.title
          }", Amount: $${amount.toLocaleString()}, Color: ${
            log.params.color || 'none'
          }`
        );
      });
    }

    if (outgoingLogs.length > 0) {
      console.log(`\n🔸 Category 14 (Money outgoing) samples:`);
      outgoingLogs.slice(0, 5).forEach((log, i) => {
        const amount = this.extractAmount ? this.extractAmount(log) : 0;
        console.log(
          `  ${i + 1}. ID: ${log.id}, Title: "${
            log.details.title
          }", Amount: $${amount.toLocaleString()}, Color: ${
            log.params.color || 'none'
          }`
        );
      });
    }

    if (incomingLogs.length > 0) {
      console.log(`\n🔸 Category 17 (Money incoming) samples:`);
      incomingLogs.slice(0, 5).forEach((log, i) => {
        const amount = this.extractAmount ? this.extractAmount(log) : 0;
        console.log(
          `  ${i + 1}. ID: ${log.id}, Title: "${
            log.details.title
          }", Amount: $${amount.toLocaleString()}, Color: ${
            log.params.color || 'none'
          }`
        );
      });
    }

    this.updateProgress(80, 'Processing transactions...');

    // Combine all logs
    const allLogs = [...moneyLogs, ...outgoingLogs, ...incomingLogs];

    console.log(`📈 TOTAL COMBINED: ${allLogs.length} transactions`);

    // Check for duplicates by ID
    const logIds = new Set<string>();
    const duplicateIds = new Set<string>();
    const duplicateTransactions = new Map<string, LogEntry[]>();

    allLogs.forEach((log) => {
      if (logIds.has(log.id)) {
        duplicateIds.add(log.id);
        if (!duplicateTransactions.has(log.id)) {
          duplicateTransactions.set(log.id, []);
        }
        duplicateTransactions.get(log.id)!.push(log);
      } else {
        logIds.add(log.id);
      }
    });

    console.log(`🚨 DUPLICATE ANALYSIS:`);
    console.log(`- Unique transaction IDs: ${logIds.size}`);
    console.log(`- Duplicate transaction IDs: ${duplicateIds.size}`);

    if (duplicateIds.size > 0) {
      console.log(`🔍 DUPLICATE TRANSACTION DETAILS:`);
      Array.from(duplicateIds)
        .slice(0, 10)
        .forEach((id) => {
          const instances = duplicateTransactions.get(id) || [];
          if (instances.length > 0) {
            const sample = instances[0];
            console.log(
              `- ID ${id}: "${sample.details.title}" appears ${
                instances.length + 1
              } times`
            );
            console.log(
              `  Categories: ${instances
                .map((i) => i.details.category)
                .join(', ')}`
            );
          }
        });
    }

    // DEDUPLICATION: Remove duplicate transactions by keeping only unique IDs
    console.log(`🔧 DEDUPLICATING TRANSACTIONS...`);
    const uniqueLogsMap = new Map<string, LogEntry>();

    // Keep the first occurrence of each transaction ID
    allLogs.forEach((log) => {
      if (!uniqueLogsMap.has(log.id)) {
        uniqueLogsMap.set(log.id, log);
      }
    });

    const deduplicatedLogs = Array.from(uniqueLogsMap.values());

    console.log(`✅ DEDUPLICATION COMPLETE:`);
    console.log(`- Original transactions: ${allLogs.length}`);
    console.log(`- After deduplication: ${deduplicatedLogs.length}`);
    console.log(
      `- Duplicates removed: ${allLogs.length - deduplicatedLogs.length}`
    );

    // Sort deduplicated logs by timestamp (newest first)
    deduplicatedLogs.sort((a, b) => b.timestamp - a.timestamp);

    // Group by day and calculate profits using deduplicated logs
    const dailyProfits = this.processDailyProfits(deduplicatedLogs, days);

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

    // Track all bazaar transactions across all days
    const allBazaarTransactions: BazaarTransactionInfo[] = [];

    console.log(`🔍 Starting analysis of ${logs.length} log entries...`);

    // Process each log entry
    for (const log of logs) {
      const date = new Date(log.timestamp * 1000);
      const dateKey = date.toISOString().split('T')[0];

      if (!dailyData.has(dateKey)) continue;

      const dayData = dailyData.get(dateKey)!;
      const amount = this.extractAmount(log);
      const isNeutral = this.isNeutralTransaction(log);

      // Check if this is a bazaar transaction
      if (this.isBazaarTransaction(log)) {
        const bazaarTransaction = this.parseBazaarTransaction(log);
        if (bazaarTransaction) {
          allBazaarTransactions.push(bazaarTransaction);
          console.log(`🏪 Bazaar transaction detected:`, {
            title: log.details.title,
            amount: this.extractAmount(log),
            isSale: bazaarTransaction.isSale,
            itemName: bazaarTransaction.itemName,
          });
        }
      }

      // Skip neutral transactions (internal transfers) from profit calculations
      if (isNeutral) {
        // Still log for analysis but don't affect profit/loss
        allTransactionPatterns.push({
          title: log.details.title,
          category: log.details.category,
          amount: amount,
          isIncome: false, // Neutral, doesn't matter
          color: log.params.color || 'none',
          data: log.data,
          classification: 'neutral_transaction',
        });
        continue;
      }

      const isIncome = this.isIncomeTransaction(log);

      // Determine classification reasoning for logging
      let classification = 'unknown';
      const title = log.details.title.toLowerCase();
      const category = log.details.category.toLowerCase();

      if (amount === 0) {
        classification = 'no_amount_found';
      } else if (log.params.color === 'green') {
        classification = 'green_color_income';
      } else if (log.params.color === 'red') {
        classification = 'red_color_expense';
      } else if (title.includes('sell')) {
        classification = 'title_contains_sell';
      } else if (title.includes('piggy bank')) {
        classification = 'piggy_bank_transfer';
      } else if (title.includes('bank invest')) {
        classification = 'bank_investment';
      } else if (title.includes('trade money')) {
        classification = 'trade_money_transfer';
      } else if (title.includes('ammo buy')) {
        classification = 'ammo_purchase';
      } else if (title.includes('buy')) {
        classification = 'title_contains_buy';
      } else if (title.includes('bet') || title.includes('lottery bet')) {
        classification = 'title_contains_bet';
      } else if (
        title.includes('casino') &&
        (title.includes('start') || title.includes('join'))
      ) {
        classification = 'casino_game_start';
      } else if (title.includes('spin the wheel start')) {
        classification = 'casino_wheel_spin';
      } else if (title.includes('bookie bet')) {
        classification = 'bookie_betting';
      } else if (title.includes('upkeep') || title.includes('donate')) {
        classification = 'maintenance_expense';
      } else if (
        title.includes('money send') ||
        title.includes('bounty place')
      ) {
        classification = 'money_transfer_out';
      } else if (category.includes('incoming')) {
        classification = 'category_incoming';
      } else if (category.includes('outgoing')) {
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

    // Convert to array format and add bazaar analytics
    const result: DailyProfit[] = [];

    console.log(`🏪 BAZAAR ANALYTICS SUMMARY:`);
    console.log(
      `- Total bazaar transactions found: ${allBazaarTransactions.length}`
    );
    if (allBazaarTransactions.length > 0) {
      const sales = allBazaarTransactions.filter((t) => t.isSale);
      const purchases = allBazaarTransactions.filter((t) => !t.isSale);
      console.log(`- Sales: ${sales.length}, Purchases: ${purchases.length}`);
      console.log(`- Sample transactions:`, allBazaarTransactions.slice(0, 3));
    }

    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      const dayData = dailyData.get(dateKey)!;

      // Filter bazaar transactions for this specific day
      const dayBazaarTransactions = allBazaarTransactions.filter(
        (transaction) => {
          const transactionDate = new Date(transaction.timestamp * 1000);
          const transactionDateKey = transactionDate
            .toISOString()
            .split('T')[0];
          return transactionDateKey === dateKey;
        }
      );

      // Calculate bazaar analytics for this day
      const bazaarAnalytics = this.calculateBazaarAnalytics(
        dayBazaarTransactions
      );

      result.push({
        date: dateKey,
        income: dayData.income,
        expenses: dayData.expenses,
        netProfit: dayData.income - dayData.expenses,
        transactions: Array.from(dayData.transactions.values()).sort(
          (a, b) => b.amount - a.amount
        ),
        bazaarAnalytics,
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

    // Track analysis issues for status indicator
    this.analysisIssues.unknownTransactions = unknownTransactions.length;

    // Count missing amount extractions and incorrect classifications
    unknownTransactions.forEach((item) => {
      if (item.extractedAmount === 0) {
        this.analysisIssues.missingAmountExtractions++;
      }
      if (
        item.classification === 'heuristic_based' ||
        item.classification === 'unknown'
      ) {
        this.analysisIssues.incorrectClassifications++;
      }
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
    console.log("4. Which item IDs couldn't be resolved");

    // Log unknown item IDs if any were found
    if (this.unknownItemIds.size > 0) {
      console.log('\n🔍 UNKNOWN ITEM IDs:');
      console.log(`Found ${this.unknownItemIds.size} unresolved item IDs:`);
      console.log(
        "Item IDs that couldn't be resolved:",
        Array.from(this.unknownItemIds).sort((a, b) => a - b)
      );
    }

    console.log('=====================================\n');

    return result.reverse(); // Show oldest first
  }

  /**
   * Extract monetary amount from a log entry
   */
  private extractAmount(log: LogEntry): number {
    const data = log.data;

    // Primary amount fields (most common) - only check if > 0
    if (data.cost_total && data.cost_total > 0) return data.cost_total;
    if (data.money_gained && data.money_gained > 0) return data.money_gained;
    if (data.money_mugged && data.money_mugged > 0) return data.money_mugged;

    // Casino and gambling fields - only check if > 0
    if (data.bet_amount && data.bet_amount > 0) return data.bet_amount;
    if (data.bet && data.bet > 0) return data.bet;
    if (data.withdrawn && data.withdrawn > 0) return data.withdrawn;
    if (data.cost && data.cost > 0) return data.cost; // Casino lottery bet, wheel spin cost
    if (data.money && data.money > 0) return data.money; // General money field
    if (data.won_amount && data.won_amount > 0) return data.won_amount; // Casino winnings
    if (data.pot && data.pot > 0) return data.pot; // Casino pot winnings

    // Mission and job rewards - only check if > 0
    if (data.credits && data.credits > 0) return data.credits;
    if (data.pay && data.pay > 0) return data.pay;

    // Property related - only check if > 0
    if (data.rent && data.rent > 0) return data.rent; // Property rent
    if (data.upkeep_paid && data.upkeep_paid > 0) return data.upkeep_paid; // Property upkeep
    if (data.donated && data.donated > 0) return data.donated; // Church donations

    // Bounties and rewards - only check if > 0
    if (data.bounty_reward && data.bounty_reward > 0) return data.bounty_reward;

    // Banking and deposits - only check if > 0
    if (data.deposited && data.deposited > 0) return data.deposited;
    if (data.amount && data.amount > 0) return data.amount;

    // Market and fee related - only check if > 0
    if (data.fee && data.fee > 0) return data.fee;
    if (data.value && data.value > 0) return data.value; // Ammo purchases, item values

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
    if (title.includes('ammo buy')) return false; // Ammo purchases (even if green)
    if (title.includes('bet') || title.includes('lottery bet')) return false;
    if (title.includes('casino') && title.includes('join')) return false;
    if (title.includes('casino') && title.includes('start')) return false;
    if (title.includes('casino') && title.includes('lose')) return false;
    if (title.includes('spin the wheel start')) return false; // Casino wheel spins
    if (title.includes('high-low start')) return false; // Casino high-low game
    if (title.includes('russian roulette join')) return false; // Casino russian roulette
    if (title.includes('russian roulette start')) return false; // Casino russian roulette
    if (title.includes('blackjack start')) return false; // Casino blackjack
    if (title.includes('bookie bet')) return false; // Bookie betting
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
   * Parse bazaar transaction from log title
   */
  private parseBazaarTransaction(log: LogEntry): BazaarTransactionInfo | null {
    const title = log.details.title;
    const amount = this.extractAmount(log);

    if (amount === 0) return null;

    // Handle simple "Bazaar sell" and "Bazaar buy" formats
    if (title.toLowerCase() === 'bazaar sell') {
      // Extract detailed information from the actual API structure
      const items = log.data?.items || [];
      const firstItem = items[0];
      const itemId = firstItem?.id;
      const quantity = firstItem?.qty || 1;
      const buyerPlayerId = log.data?.buyer;
      const unitPrice = log.data?.cost_each || amount;

      // Use actual item name from mapping
      const itemName = itemId ? this.getItemName(itemId) : 'Unknown Item';
      const tradingPartner = buyerPlayerId
        ? `Player [${buyerPlayerId}]`
        : 'Unknown Player';

      return {
        itemName,
        quantity,
        unitPrice,
        totalAmount: amount,
        tradingPartner,
        isSale: true,
        timestamp: log.timestamp,
        originalTitle: title,
      };
    }

    if (title.toLowerCase() === 'bazaar buy') {
      // Extract detailed information from the actual API structure
      const items = log.data?.items || [];
      const firstItem = items[0];
      const itemId = firstItem?.id;
      const quantity = firstItem?.qty || 1;
      const sellerPlayerId = log.data?.seller;
      const unitPrice = log.data?.cost_each || amount;

      // Use actual item name from mapping
      const itemName = itemId ? this.getItemName(itemId) : 'Unknown Item';
      const tradingPartner = sellerPlayerId
        ? `Player [${sellerPlayerId}]`
        : 'Unknown Player';

      return {
        itemName,
        quantity,
        unitPrice,
        totalAmount: amount,
        tradingPartner,
        isSale: false,
        timestamp: log.timestamp,
        originalTitle: title,
      };
    }

    // Pattern 1: "You bought [item] from [player] for $[amount]"
    const buyPattern = /You bought (.+?) from (.+?) \[(\d+)\] for \$[\d,]+/;
    const buyMatch = title.match(buyPattern);

    if (buyMatch) {
      const [, itemPart, playerName, playerId] = buyMatch;
      const { itemName, quantity } = this.parseItemQuantity(itemPart);

      return {
        itemName,
        quantity,
        unitPrice: amount / quantity,
        totalAmount: amount,
        tradingPartner: playerName,
        playerId,
        isSale: false,
        timestamp: log.timestamp,
        originalTitle: title,
      };
    }

    // Pattern 2: "You sold [item] to [player] for $[amount]"
    const sellPattern = /You sold (.+?) to (.+?) \[(\d+)\] for \$[\d,]+/;
    const sellMatch = title.match(sellPattern);

    if (sellMatch) {
      const [, itemPart, playerName, playerId] = sellMatch;
      const { itemName, quantity } = this.parseItemQuantity(itemPart);

      return {
        itemName,
        quantity,
        unitPrice: amount / quantity,
        totalAmount: amount,
        tradingPartner: playerName,
        playerId,
        isSale: true,
        timestamp: log.timestamp,
        originalTitle: title,
      };
    }

    // Pattern 3: "[Player] bought [item] for $[amount]" (your bazaar sales)
    const bazaarSalePattern = /(.+?) \[(\d+)\] bought (.+?) for \$[\d,]+/;
    const bazaarSaleMatch = title.match(bazaarSalePattern);

    if (bazaarSaleMatch) {
      const [, playerName, playerId, itemPart] = bazaarSaleMatch;
      const { itemName, quantity } = this.parseItemQuantity(itemPart);

      return {
        itemName,
        quantity,
        unitPrice: amount / quantity,
        totalAmount: amount,
        tradingPartner: playerName,
        playerId,
        isSale: true,
        timestamp: log.timestamp,
        originalTitle: title,
      };
    }

    // Pattern 4: "[Player] bought [item] from your bazaar for $[amount]"
    const bazaarFromPattern =
      /(.+?) \[(\d+)\] bought (.+?) from your bazaar for \$[\d,]+/;
    const bazaarFromMatch = title.match(bazaarFromPattern);

    if (bazaarFromMatch) {
      const [, playerName, playerId, itemPart] = bazaarFromMatch;
      const { itemName, quantity } = this.parseItemQuantity(itemPart);

      return {
        itemName,
        quantity,
        unitPrice: amount / quantity,
        totalAmount: amount,
        tradingPartner: playerName,
        playerId,
        isSale: true,
        timestamp: log.timestamp,
        originalTitle: title,
      };
    }

    return null;
  }

  /**
   * Parse item name and quantity from item string (e.g., "Xanax x5" -> {itemName: "Xanax", quantity: 5})
   */
  private parseItemQuantity(itemPart: string): {
    itemName: string;
    quantity: number;
  } {
    // Pattern: "Item Name x10" or "Item Name"
    const quantityMatch = itemPart.match(/(.+?)\s+x(\d+)$/);

    if (quantityMatch) {
      const [, itemName, quantityStr] = quantityMatch;
      return {
        itemName: itemName.trim(),
        quantity: parseInt(quantityStr, 10),
      };
    }

    // No quantity specified, assume 1
    return {
      itemName: itemPart.trim(),
      quantity: 1,
    };
  }

  /**
   * Check if a log entry is a bazaar transaction
   */
  private isBazaarTransaction(log: LogEntry): boolean {
    const title = log.details.title.toLowerCase();

    return (
      title.includes('bazaar sell') ||
      title.includes('bazaar buy') ||
      (title.includes('you bought') &&
        title.includes('from') &&
        title.includes('[') &&
        title.includes(']')) ||
      (title.includes('you sold') &&
        title.includes('to') &&
        title.includes('[') &&
        title.includes(']')) ||
      (title.includes('bought') &&
        title.includes('for $') &&
        title.includes('[') &&
        title.includes(']')) ||
      (title.includes('bought') && title.includes('from your bazaar'))
    );
  }

  /**
   * Calculate comprehensive bazaar analytics from transactions
   */
  private calculateBazaarAnalytics(
    bazaarTransactions: BazaarTransactionInfo[]
  ): BazaarAnalytics {
    if (bazaarTransactions.length === 0) {
      return {
        totalBazaarProfit: 0,
        totalBazaarVolume: 0,
        totalTransactions: 0,
        mostProfitableItem: 'N/A',
        bestTradingPartner: 'N/A',
        itemAnalytics: [],
        tradingPartners: [],
        bazaarTransactions: [],
      };
    }

    // Group transactions by item
    const itemGroups = new Map<string, BazaarTransactionInfo[]>();
    bazaarTransactions.forEach((transaction) => {
      const key = transaction.itemName;
      if (!itemGroups.has(key)) {
        itemGroups.set(key, []);
      }
      itemGroups.get(key)!.push(transaction);
    });

    // Calculate item analytics
    const itemAnalytics: ItemAnalytics[] = [];
    let totalProfit = 0;
    let totalVolume = 0;

    itemGroups.forEach((transactions, itemName) => {
      const purchases = transactions.filter((t) => !t.isSale);
      const sales = transactions.filter((t) => t.isSale);

      const totalBought = purchases.reduce((sum, t) => sum + t.totalAmount, 0);
      const totalSold = sales.reduce((sum, t) => sum + t.totalAmount, 0);
      const totalQuantityBought = purchases.reduce(
        (sum, t) => sum + t.quantity,
        0
      );
      const totalQuantitySold = sales.reduce((sum, t) => sum + t.quantity, 0);

      const avgBuyPrice =
        totalQuantityBought > 0 ? totalBought / totalQuantityBought : 0;
      const avgSellPrice =
        totalQuantitySold > 0 ? totalSold / totalQuantitySold : 0;
      const profitMargin =
        avgBuyPrice > 0
          ? ((avgSellPrice - avgBuyPrice) / avgBuyPrice) * 100
          : 0;
      const netProfit = totalSold - totalBought;

      totalProfit += netProfit;
      totalVolume += totalBought + totalSold;

      itemAnalytics.push({
        itemName,
        totalBought,
        totalSold,
        totalQuantityBought,
        totalQuantitySold,
        avgBuyPrice,
        avgSellPrice,
        profitMargin,
        netProfit,
        transactionCount: transactions.length,
        lastActivity: Math.max(...transactions.map((t) => t.timestamp)),
      });
    });

    // Sort by net profit descending
    itemAnalytics.sort((a, b) => b.netProfit - a.netProfit);

    // Group by trading partner
    const partnerGroups = new Map<string, BazaarTransactionInfo[]>();
    bazaarTransactions.forEach((transaction) => {
      const key = transaction.tradingPartner;
      if (!partnerGroups.has(key)) {
        partnerGroups.set(key, []);
      }
      partnerGroups.get(key)!.push(transaction);
    });

    // Calculate trading partner analytics
    const tradingPartners: TradingPartnerAnalytics[] = [];
    partnerGroups.forEach((transactions, partnerName) => {
      const itemCounts = new Map<string, number>();
      transactions.forEach((transaction) => {
        const count = itemCounts.get(transaction.itemName) || 0;
        itemCounts.set(transaction.itemName, count + 1);
      });

      const mostTradedItem =
        Array.from(itemCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        'N/A';

      tradingPartners.push({
        partnerName,
        playerId: transactions[0].playerId,
        totalTransactions: transactions.length,
        totalVolume: transactions.reduce((sum, t) => sum + t.totalAmount, 0),
        mostTradedItem,
        lastTransaction: Math.max(...transactions.map((t) => t.timestamp)),
      });
    });

    // Sort by total volume descending
    tradingPartners.sort((a, b) => b.totalVolume - a.totalVolume);

    return {
      totalBazaarProfit: totalProfit,
      totalBazaarVolume: totalVolume,
      totalTransactions: bazaarTransactions.length,
      mostProfitableItem: itemAnalytics[0]?.itemName || 'N/A',
      bestTradingPartner: tradingPartners[0]?.partnerName || 'N/A',
      itemAnalytics,
      tradingPartners,
      bazaarTransactions,
    };
  }

  private isNeutralTransaction(log: LogEntry): boolean {
    const title = log.details.title.toLowerCase();

    // Internal transfers and neutral actions
    if (title.includes('piggy bank deposit')) return true; // Moving money to piggy bank
    if (title.includes('piggy bank withdraw')) return true; // Taking money from piggy bank
    if (title.includes('bank deposit') && !title.includes('interest'))
      return true; // Bank deposits (not interest)
    if (title.includes('bank withdraw') && !title.includes('fee')) return true; // Bank withdrawals (not fees)
    if (title.includes('bank invest')) return true; // Bank investments (moving money to investment)

    // Trading money movements (just moving money around in trades, not profit)
    if (
      title.includes('trade money add') ||
      title.includes('trade money remove')
    )
      return true;

    // Other internal transfers
    if (title.includes('faction money balance change')) return true; // Faction money transfers

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

  /**
   * Get current analysis issues for status indicator
   */
  getAnalysisIssues() {
    return {
      ...this.analysisIssues,
      unresolvedItemIds: this.unknownItemIds.size,
    };
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
  private bazaarAnalytics: HTMLElement;
  private errorSection: HTMLElement;
  private errorMessage: HTMLElement;
  private retryBtn: HTMLButtonElement;
  private dailyProfits: DailyProfit[] = [];

  // Status indicator elements
  private statusActionsSection: HTMLElement;
  private statusIndicator: HTMLElement;
  private statusTitle: HTMLElement;

  // Copy logs elements
  private copyLogsBtn: HTMLButtonElement;

  // Console log capture
  private consoleLogs: string[] = [];
  private originalConsoleLog: typeof console.log;

  constructor() {
    this.profitLogger = new ProfitLogger();
    this.setupConsoleCapture();
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
    this.bazaarAnalytics = document.getElementById(
      'bazaarAnalytics'
    ) as HTMLElement;
    this.errorSection = document.getElementById('errorSection') as HTMLElement;
    this.errorMessage = document.getElementById('errorMessage') as HTMLElement;
    this.retryBtn = document.getElementById('retryBtn') as HTMLButtonElement;

    // Status indicator elements
    this.statusActionsSection = document.getElementById(
      'statusActionsSection'
    ) as HTMLElement;
    this.statusIndicator = document.getElementById(
      'statusIndicator'
    ) as HTMLElement;
    this.statusTitle = document.getElementById('statusTitle') as HTMLElement;

    // Copy logs button
    this.copyLogsBtn = document.getElementById(
      'copyLogsBtn'
    ) as HTMLButtonElement;
  }

  private bindEvents() {
    this.analyzeBtn.addEventListener('click', () => this.startAnalysis());
    this.retryBtn.addEventListener('click', () => this.startAnalysis());
    this.copyLogsBtn.addEventListener('click', () =>
      this.copyLogsToClipboard()
    );
  }

  private async startAnalysis() {
    try {
      this.hideError();
      this.hideResults();
      this.hideStatusIndicator();
      this.clearConsoleLogs(); // Clear previous logs
      this.showProgress();

      const days = parseInt(this.daysInput.value) || 7;
      const results = await this.profitLogger.analyzeProfitForDays(days);

      // Store results for sorting functionality
      this.dailyProfits = results;

      this.hideProgress();
      this.displayResults(results);
      this.updateStatusIndicator();
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

  private hideStatusIndicator() {
    this.statusActionsSection.classList.add('hidden');
  }

  private updateStatusIndicator() {
    const issues = this.profitLogger.getAnalysisIssues();
    const hasIssues =
      issues.unknownTransactions > 0 ||
      issues.missingAmountExtractions > 0 ||
      issues.incorrectClassifications > 0 ||
      issues.unresolvedItemIds > 0;

    // Show the status actions section
    this.statusActionsSection.classList.remove('hidden');

    if (hasIssues) {
      // Show warning status
      this.statusIndicator.classList.remove('status-ok');
      this.statusIndicator.classList.add('status-warning');
      this.statusTitle.textContent = 'Issues Found';
    } else {
      // Show success status
      this.statusIndicator.classList.remove('status-warning');
      this.statusIndicator.classList.add('status-ok');
      this.statusTitle.textContent = 'All Good';
    }
  }

  /**
   * Setup console capture to save all console.log output
   */
  private setupConsoleCapture() {
    this.originalConsoleLog = console.log;
    this.consoleLogs = [];

    console.log = (...args: any[]) => {
      // Call original console.log
      this.originalConsoleLog.apply(console, args);

      // Capture the log message
      const timestamp = new Date().toLocaleTimeString();
      const message = args
        .map((arg) => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2);
            } catch (e) {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(' ');

      this.consoleLogs.push(`[${timestamp}] ${message}`);
    };
  }

  /**
   * Copy all console logs to clipboard
   */
  private async copyLogsToClipboard() {
    try {
      if (this.consoleLogs.length === 0) {
        // Show temporary message if no logs
        const originalText = this.copyLogsBtn.textContent;
        this.copyLogsBtn.textContent = 'No logs to copy';
        this.copyLogsBtn.disabled = true;

        setTimeout(() => {
          this.copyLogsBtn.textContent = originalText;
          this.copyLogsBtn.disabled = false;
        }, 2000);
        return;
      }

      // Prepare the log content
      const logContent = [
        '=== TORN HELPER - PROFIT ANALYSIS LOGS ===',
        `Generated: ${new Date().toLocaleString()}`,
        `Total logs: ${this.consoleLogs.length}`,
        '',
        '=== CONSOLE LOGS ===',
        ...this.consoleLogs,
        '',
        '=== END OF LOGS ===',
      ].join('\n');

      // Copy to clipboard
      await navigator.clipboard.writeText(logContent);

      // Show success feedback
      const originalText = this.copyLogsBtn.textContent;
      const originalClass = this.copyLogsBtn.className;

      this.copyLogsBtn.textContent = 'Copied!';
      this.copyLogsBtn.classList.add('copied');

      setTimeout(() => {
        this.copyLogsBtn.textContent = originalText;
        this.copyLogsBtn.className = originalClass;
      }, 2000);
    } catch (error) {
      console.error('Failed to copy logs to clipboard:', error);

      // Show error feedback
      const originalText = this.copyLogsBtn.textContent;
      this.copyLogsBtn.textContent = 'Copy failed';
      this.copyLogsBtn.disabled = true;

      setTimeout(() => {
        this.copyLogsBtn.textContent = originalText;
        this.copyLogsBtn.disabled = false;
      }, 2000);
    }
  }

  /**
   * Clear captured console logs
   */
  private clearConsoleLogs() {
    this.consoleLogs = [];
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

    // Display bazaar analytics
    this.displayBazaarAnalytics(dailyProfits);
  }

  private displayBazaarAnalytics(dailyProfits: DailyProfit[]) {
    // Combine all bazaar analytics across all days
    const allItemAnalytics = new Map<string, ItemAnalytics>();
    const allPartnerAnalytics = new Map<string, TradingPartnerAnalytics>();
    let totalBazaarProfit = 0;
    let totalBazaarVolume = 0;
    let totalBazaarTransactions = 0;

    dailyProfits.forEach((day) => {
      if (day.bazaarAnalytics) {
        totalBazaarProfit += day.bazaarAnalytics.totalBazaarProfit;
        totalBazaarVolume += day.bazaarAnalytics.totalBazaarVolume;
        totalBazaarTransactions += day.bazaarAnalytics.totalTransactions;

        // Merge item analytics
        day.bazaarAnalytics.itemAnalytics.forEach((item) => {
          if (allItemAnalytics.has(item.itemName)) {
            const existing = allItemAnalytics.get(item.itemName)!;
            existing.totalBought += item.totalBought;
            existing.totalSold += item.totalSold;
            existing.totalQuantityBought += item.totalQuantityBought;
            existing.totalQuantitySold += item.totalQuantitySold;
            existing.netProfit += item.netProfit;
            existing.transactionCount += item.transactionCount;
            existing.lastActivity = Math.max(
              existing.lastActivity,
              item.lastActivity
            );

            // Recalculate averages
            existing.avgBuyPrice =
              existing.totalQuantityBought > 0
                ? existing.totalBought / existing.totalQuantityBought
                : 0;
            existing.avgSellPrice =
              existing.totalQuantitySold > 0
                ? existing.totalSold / existing.totalQuantitySold
                : 0;
            existing.profitMargin =
              existing.avgBuyPrice > 0
                ? ((existing.avgSellPrice - existing.avgBuyPrice) /
                    existing.avgBuyPrice) *
                  100
                : 0;
          } else {
            allItemAnalytics.set(item.itemName, { ...item });
          }
        });

        // Merge partner analytics
        day.bazaarAnalytics.tradingPartners.forEach((partner) => {
          if (allPartnerAnalytics.has(partner.partnerName)) {
            const existing = allPartnerAnalytics.get(partner.partnerName)!;
            existing.totalTransactions += partner.totalTransactions;
            existing.totalVolume += partner.totalVolume;
            existing.lastTransaction = Math.max(
              existing.lastTransaction,
              partner.lastTransaction
            );
          } else {
            allPartnerAnalytics.set(partner.partnerName, { ...partner });
          }
        });
      }
    });

    const itemAnalytics = Array.from(allItemAnalytics.values()).sort(
      (a, b) => b.netProfit - a.netProfit
    );
    const partnerAnalytics = Array.from(allPartnerAnalytics.values()).sort(
      (a, b) => b.totalVolume - a.totalVolume
    );

    if (totalBazaarTransactions === 0) {
      this.bazaarAnalytics.innerHTML = `
        <div class="no-data">
          <p>No bazaar transactions found in the selected time period.</p>
          <p>Bazaar transactions include buying and selling items from/to other players.</p>
        </div>
      `;
      return;
    }

    this.bazaarAnalytics.innerHTML = `
      <!-- Summary Cards -->
      <div class="bazaar-summary">
        <div class="bazaar-summary-card profit">
          <div class="bazaar-summary-label">Total Bazaar Profit</div>
          <div class="bazaar-summary-value ${
            totalBazaarProfit >= 0 ? 'profit-positive' : 'profit-negative'
          }">
            $${totalBazaarProfit.toLocaleString()}
          </div>
        </div>
        <div class="bazaar-summary-card volume">
          <div class="bazaar-summary-label">Total Volume</div>
          <div class="bazaar-summary-value">$${totalBazaarVolume.toLocaleString()}</div>
        </div>
        <div class="bazaar-summary-card transactions">
          <div class="bazaar-summary-label">Total Transactions</div>
          <div class="bazaar-summary-value">${totalBazaarTransactions}</div>
        </div>
        <div class="bazaar-summary-card">
          <div class="bazaar-summary-label">Avg Profit/Transaction</div>
          <div class="bazaar-summary-value">
            $${Math.round(
              totalBazaarProfit / totalBazaarTransactions
            ).toLocaleString()}
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="bazaar-tabs">
        <button class="bazaar-tab active" data-tab="items">Items</button>
        <button class="bazaar-tab" data-tab="partners">Trading Partners</button>
      </div>

      <!-- Items Tab Content -->
      <div class="bazaar-content active" id="items-content">
        ${
          itemAnalytics.length > 0
            ? `
          <table class="items-table" id="bazaarItemsTable">
            <thead>
              <tr>
                <th data-sort="itemName" class="sortable">
                  Item
                  <span class="sort-indicator"></span>
                </th>
                <th data-sort="netProfit" class="sortable">
                  Net Profit
                  <span class="sort-indicator"></span>
                </th>
                <th data-sort="profitMargin" class="sortable">
                  Profit Margin
                  <span class="sort-indicator"></span>
                </th>
                <th data-sort="totalQuantityBought" class="sortable">
                  Bought
                  <span class="sort-indicator"></span>
                </th>
                <th data-sort="totalQuantitySold" class="sortable">
                  Sold
                  <span class="sort-indicator"></span>
                </th>
                <th data-sort="avgBuyPrice" class="sortable">
                  Avg Buy Price
                  <span class="sort-indicator"></span>
                </th>
                <th data-sort="avgSellPrice" class="sortable">
                  Avg Sell Price
                  <span class="sort-indicator"></span>
                </th>
                <th data-sort="transactionCount" class="sortable">
                  Transactions
                  <span class="sort-indicator"></span>
                </th>
              </tr>
            </thead>
            <tbody>
              ${itemAnalytics
                .map(
                  (item) => `
                <tr>
                  <td><strong>${item.itemName}</strong></td>
                  <td class="number ${
                    item.netProfit >= 0 ? 'profit-positive' : 'profit-negative'
                  }">
                    $${item.netProfit.toLocaleString()}
                  </td>
                  <td class="number ${this.getMarginClass(item.profitMargin)}">
                    ${item.profitMargin.toFixed(1)}%
                  </td>
                  <td class="number">${item.totalQuantityBought}</td>
                  <td class="number">${item.totalQuantitySold}</td>
                  <td class="number">$${item.avgBuyPrice.toLocaleString()}</td>
                  <td class="number">$${item.avgSellPrice.toLocaleString()}</td>
                  <td class="number">${item.transactionCount}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        `
            : '<div class="no-data">No item data available</div>'
        }
      </div>

      <!-- Partners Tab Content -->
      <div class="bazaar-content" id="partners-content">
        ${
          partnerAnalytics.length > 0
            ? `
          <table class="partners-table" id="bazaarPartnersTable">
            <thead>
              <tr>
                <th data-sort="partnerName" class="sortable">
                  Trading Partner
                  <span class="sort-indicator"></span>
                </th>
                <th data-sort="totalVolume" class="sortable">
                  Total Volume
                  <span class="sort-indicator"></span>
                </th>
                <th data-sort="totalTransactions" class="sortable">
                  Transactions
                  <span class="sort-indicator"></span>
                </th>
                <th data-sort="mostTradedItem" class="sortable">
                  Most Traded Item
                  <span class="sort-indicator"></span>
                </th>
                <th data-sort="lastTransaction" class="sortable">
                  Last Transaction
                  <span class="sort-indicator"></span>
                </th>
              </tr>
            </thead>
            <tbody>
              ${partnerAnalytics
                .map(
                  (partner) => `
                <tr>
                  <td><strong>${partner.partnerName}</strong></td>
                  <td class="number">$${partner.totalVolume.toLocaleString()}</td>
                  <td class="number">${partner.totalTransactions}</td>
                  <td>${partner.mostTradedItem}</td>
                  <td>${new Date(
                    partner.lastTransaction * 1000
                  ).toLocaleDateString()}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        `
            : '<div class="no-data">No trading partner data available</div>'
        }
      </div>
    `;

    // Add tab switching functionality
    this.setupBazaarTabs();
    this.setupBazaarSorting();
  }

  private getMarginClass(margin: number): string {
    if (margin >= 20) return 'margin-high';
    if (margin >= 5) return 'margin-medium';
    return 'margin-low';
  }

  private setupBazaarTabs() {
    const tabs = document.querySelectorAll('.bazaar-tab');
    const contents = document.querySelectorAll('.bazaar-content');

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetTab = tab.getAttribute('data-tab');

        // Remove active from all tabs and contents
        tabs.forEach((t) => t.classList.remove('active'));
        contents.forEach((c) => c.classList.remove('active'));

        // Add active to clicked tab and corresponding content
        tab.classList.add('active');
        document
          .getElementById(`${targetTab}-content`)
          ?.classList.add('active');
      });
    });
  }

  private setupBazaarSorting() {
    // Setup sorting for items table
    this.setupTableSorting('bazaarItemsTable', 'items');
    // Setup sorting for partners table
    this.setupTableSorting('bazaarPartnersTable', 'partners');
  }

  private setupTableSorting(tableId: string, dataType: 'items' | 'partners') {
    const table = document.getElementById(tableId);
    if (!table) return;

    const sortableHeaders = table.querySelectorAll('th.sortable');
    let currentSort = { column: '', direction: 'desc' };

    sortableHeaders.forEach((header) => {
      header.addEventListener('click', () => {
        const sortColumn = header.getAttribute('data-sort');
        if (!sortColumn) return;

        // Toggle direction if same column, otherwise use desc for new column
        if (currentSort.column === sortColumn) {
          currentSort.direction =
            currentSort.direction === 'desc' ? 'asc' : 'desc';
        } else {
          currentSort.column = sortColumn;
          currentSort.direction = 'desc';
        }

        // Update sort indicators
        this.updateBazaarSortIndicators(table, currentSort);

        // Sort and re-render the table
        this.sortAndRenderBazaarTable(tableId, dataType, currentSort);
      });
    });
  }

  private updateBazaarSortIndicators(
    table: Element,
    currentSort: { column: string; direction: string }
  ) {
    // Remove all active states
    table.querySelectorAll('th.sortable').forEach((header) => {
      header.classList.remove('active', 'asc', 'desc');
    });

    // Add active state to current sort column
    const activeHeader = table.querySelector(
      `th[data-sort="${currentSort.column}"]`
    );
    if (activeHeader) {
      activeHeader.classList.add('active', currentSort.direction);
    }
  }

  private sortAndRenderBazaarTable(
    tableId: string,
    dataType: 'items' | 'partners',
    currentSort: { column: string; direction: string }
  ) {
    // Get the latest daily profits to re-sort
    const latestDailyProfits = this.dailyProfits;
    if (!latestDailyProfits.length) return;

    // Get bazaar analytics from the latest day
    const latestDay = latestDailyProfits[latestDailyProfits.length - 1];
    if (!latestDay.bazaarAnalytics) return;

    let sortedData: any[];

    if (dataType === 'items') {
      sortedData = [...latestDay.bazaarAnalytics.itemAnalytics];
    } else {
      sortedData = [...latestDay.bazaarAnalytics.tradingPartners];
    }

    // Sort the data
    sortedData.sort((a, b) => {
      const aVal = a[currentSort.column];
      const bVal = b[currentSort.column];

      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      let comparison = 0;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      }

      return currentSort.direction === 'asc' ? comparison : -comparison;
    });

    // Re-render the table body with sorted data
    const tableBody = document.querySelector(`#${tableId} tbody`);
    if (!tableBody) return;

    if (dataType === 'items') {
      tableBody.innerHTML = sortedData
        .map(
          (item) => `
        <tr>
          <td><strong>${item.itemName}</strong></td>
          <td class="number ${
            item.netProfit >= 0 ? 'profit-positive' : 'profit-negative'
          }">
            $${item.netProfit.toLocaleString()}
          </td>
          <td class="number ${this.getMarginClass(item.profitMargin)}">
            ${item.profitMargin.toFixed(1)}%
          </td>
          <td class="number">${item.totalQuantityBought}</td>
          <td class="number">${item.totalQuantitySold}</td>
          <td class="number">$${item.avgBuyPrice.toLocaleString()}</td>
          <td class="number">$${item.avgSellPrice.toLocaleString()}</td>
          <td class="number">${item.transactionCount}</td>
        </tr>
      `
        )
        .join('');
    } else {
      tableBody.innerHTML = sortedData
        .map(
          (partner) => `
        <tr>
          <td><strong>${partner.partnerName}</strong></td>
          <td class="number">$${partner.totalVolume.toLocaleString()}</td>
          <td class="number">${partner.totalTransactions}</td>
          <td>${partner.mostTradedItem}</td>
          <td>${new Date(
            partner.lastTransaction * 1000
          ).toLocaleDateString()}</td>
        </tr>
      `
        )
        .join('');
    }
  }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new ProfitLoggerUI();
});

export { ProfitLogger, ProfitLoggerUI };
