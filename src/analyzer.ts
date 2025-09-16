import { ProfitAnalysisItem } from '@/types';

interface ProfitAnalysisData {
  lastUpdated: string;
  totalItems: number;
  profitableItems: number;
  results: ProfitAnalysisItem[];
}

class ProfitAnalyzer {
  private results: ProfitAnalysisItem[] = [];
  private analysisData: ProfitAnalysisData | null = null;
  private currentSort: {
    column: keyof ProfitAnalysisItem;
    direction: 'asc' | 'desc';
  } = {
    column: 'profitMargin',
    direction: 'desc',
  };

  // DOM elements
  private progressSection: HTMLElement;
  private progressFill: HTMLElement;
  private progressText: HTMLElement;
  private resultsSection: HTMLElement;
  private resultsSummary: HTMLElement;
  private resultsTable: HTMLTableElement;
  private resultsTableBody: HTMLElement;
  private emptyState: HTMLElement;

  constructor() {
    this.initializeDOM();
    this.attachEventListeners();
    this.loadAnalysisData();
  }

  private initializeDOM(): void {
    this.progressSection = document.getElementById('progressSection')!;
    this.progressFill = document.getElementById('progressFill')!;
    this.progressText = document.getElementById('progressText')!;
    this.resultsSection = document.getElementById('resultsSection')!;
    this.resultsSummary = document.getElementById('resultsSummary')!;
    this.resultsTable = document.getElementById(
      'resultsTable'
    ) as HTMLTableElement;
    this.resultsTableBody = document.getElementById('resultsTableBody')!;
    this.emptyState = document.getElementById('emptyState')!;
  }

  private attachEventListeners(): void {
    // Add click listeners to sortable table headers
    this.resultsTable.querySelectorAll('th.sortable').forEach((header) => {
      header.addEventListener('click', () => {
        const sortColumn = header.getAttribute(
          'data-sort'
        ) as keyof ProfitAnalysisItem;
        this.handleHeaderClick(sortColumn);
      });
    });
  }

  private async loadAnalysisData(): Promise<void> {
    try {
      this.showProgress();
      this.updateProgress(50, 'Loading profit analysis data...');

      const response = await fetch('/data/profit-analysis.json');
      if (!response.ok) {
        throw new Error(`Failed to load data: ${response.status}`);
      }

      this.analysisData = await response.json();
      this.results = this.analysisData?.results || [];

      this.updateProgress(100, 'Data loaded successfully!');

      setTimeout(() => {
        this.displayResults();
      }, 500);
    } catch (error) {
      this.showError(
        'Failed to load profit analysis data: ' + (error as Error).message
      );
      this.hideProgress();
    }
  }

  private displayResults(): void {
    this.sortResults();
    this.updateSortIndicators();
    this.showResults();
    this.updateSummary();
    this.hideProgress();
  }

  private handleHeaderClick(column: keyof ProfitAnalysisItem): void {
    // Toggle direction if same column, otherwise use desc for new column
    if (this.currentSort.column === column) {
      this.currentSort.direction =
        this.currentSort.direction === 'desc' ? 'asc' : 'desc';
    } else {
      this.currentSort.column = column;
      this.currentSort.direction = 'desc';
    }

    this.sortResults();
    this.updateSortIndicators();
  }

  private updateSortIndicators(): void {
    // Remove all active states
    this.resultsTable.querySelectorAll('th.sortable').forEach((header) => {
      header.classList.remove('active', 'asc', 'desc');
    });

    // Add active state to current sort column
    const activeHeader = this.resultsTable.querySelector(
      `th[data-sort="${this.currentSort.column}"]`
    );
    if (activeHeader) {
      activeHeader.classList.add('active', this.currentSort.direction);
    }
  }

  private sortResults(): void {
    const { column, direction } = this.currentSort;

    this.results.sort((a, b) => {
      const aVal = a[column];
      const bVal = b[column];

      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      let comparison = 0;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      }

      return direction === 'asc' ? comparison : -comparison;
    });

    this.renderTable();
  }

  private renderTable(): void {
    this.resultsTableBody.innerHTML = '';

    this.results.forEach((item) => {
      const row = document.createElement('tr');

      row.innerHTML = `
        <td>${item.name}</td>
        <td>${this.formatCurrency(item.shopPrice)}</td>
        <td>${
          item.bazaarPrice ? this.formatCurrency(item.bazaarPrice) : 'N/A'
        }</td>
        <td class="${this.getProfitClass(item.profit)}">${
        item.profit !== null ? this.formatCurrency(item.profit) : 'N/A'
      }</td>
        <td class="${this.getProfitClass(item.profitMargin)}">${
        item.profitMargin !== null
          ? this.formatPercentage(item.profitMargin)
          : 'N/A'
      }</td>
        <td class="${this.getProfitClass(item.profitPer100)}">${
        item.profitPer100 !== null
          ? this.formatCurrency(item.profitPer100)
          : 'N/A'
      }</td>
        <td>${item.maxStock.toLocaleString()}</td>
        <td><span class="${this.getStatusClass(item.status)}">${
        item.status
      }</span></td>
        <td>${item.shopName}</td>
      `;

      this.resultsTableBody.appendChild(row);
    });
  }

  private updateSummary(): void {
    if (!this.analysisData) return;

    const profitable = this.results.filter((r) => r.status === 'Profitable');
    const avgMargin =
      profitable.length > 0
        ? profitable.reduce((sum, r) => sum + (r.profitMargin || 0), 0) /
          profitable.length
        : 0;

    const lastUpdated = new Date(
      this.analysisData.lastUpdated
    ).toLocaleString();

    this.resultsSummary.innerHTML = `
      <div class="summary-item">
        <span class="summary-label">Total Items:</span>
        <span class="summary-value">${this.analysisData.totalItems}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Profitable:</span>
        <span class="summary-value">${this.analysisData.profitableItems}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Avg Margin:</span>
        <span class="summary-value">${avgMargin.toFixed(1)}%</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Last Updated:</span>
        <span class="summary-value">${lastUpdated}</span>
      </div>
    `;
  }

  // UI helper methods
  private updateProgress(percentage: number, message: string): void {
    this.progressFill.style.width = `${percentage}%`;
    this.progressText.textContent = message;
  }

  private showProgress(): void {
    this.progressSection.classList.remove('hidden');
    this.hideResults();
    this.hideEmptyState();
  }

  private hideProgress(): void {
    this.progressSection.classList.add('hidden');
  }

  private showResults(): void {
    this.resultsSection.classList.remove('hidden');
  }

  private hideResults(): void {
    this.resultsSection.classList.add('hidden');
  }

  private hideEmptyState(): void {
    this.emptyState.classList.add('hidden');
  }

  private showError(message: string): void {
    alert(message);
  }

  // Formatting methods
  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
      .format(amount)
      .replace('$', '$');
  }

  private formatPercentage(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  private getProfitClass(value: number | null): string {
    if (value === null) return '';
    return value > 0 ? 'profit-positive' : 'profit-negative';
  }

  private getStatusClass(status: string): string {
    return status === 'Profitable'
      ? 'status-profitable'
      : 'status-not-profitable';
  }
}

// Initialize the profit analyzer when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new ProfitAnalyzer();
});
