import {
  ProfitAnalysisItem,
  ProfitAnalysisResult,
  ShopData,
  ShopDataItem,
} from '@/types';
import { StorageManager } from './storage';
import { TornAPI } from './api/torn';
import { TornExchangeAPI } from './api/tornexchange';

class ProfitAnalyzer {
  private storage: StorageManager;
  private tornAPI: TornAPI | null = null;
  private teAPI: TornExchangeAPI;
  private results: ProfitAnalysisItem[] = [];
  private currentSort: {
    column: keyof ProfitAnalysisItem;
    direction: 'asc' | 'desc';
  } = {
    column: 'profitMargin',
    direction: 'desc',
  };

  // DOM elements
  private analyzeBtn: HTMLButtonElement;
  private progressSection: HTMLElement;
  private progressFill: HTMLElement;
  private progressText: HTMLElement;
  private resultsSection: HTMLElement;
  private resultsSummary: HTMLElement;
  private resultsTable: HTMLTableElement;
  private resultsTableBody: HTMLElement;
  private exportBtn: HTMLButtonElement;
  private emptyState: HTMLElement;

  constructor() {
    this.storage = new StorageManager();
    this.teAPI = new TornExchangeAPI();

    this.initializeAPI();
    this.initializeDOM();
    this.attachEventListeners();
  }

  private initializeAPI(): void {
    const storedKey = this.storage.getApiKey();
    if (storedKey) {
      this.tornAPI = new TornAPI(storedKey.key);
    } else {
      // Redirect to main page if no API key
      window.location.href = '/';
    }
  }

  private initializeDOM(): void {
    this.analyzeBtn = document.getElementById(
      'analyzeBtn'
    ) as HTMLButtonElement;
    this.progressSection = document.getElementById('progressSection')!;
    this.progressFill = document.getElementById('progressFill')!;
    this.progressText = document.getElementById('progressText')!;
    this.resultsSection = document.getElementById('resultsSection')!;
    this.resultsSummary = document.getElementById('resultsSummary')!;
    this.resultsTable = document.getElementById(
      'resultsTable'
    ) as HTMLTableElement;
    this.resultsTableBody = document.getElementById('resultsTableBody')!;
    this.exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
    this.emptyState = document.getElementById('emptyState')!;
  }

  private attachEventListeners(): void {
    this.analyzeBtn.addEventListener('click', () => this.startAnalysis());
    this.exportBtn.addEventListener('click', () => this.exportResults());

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

  private async startAnalysis(): Promise<void> {
    if (!this.tornAPI) return;

    try {
      this.showProgress();
      this.hideEmptyState();
      this.hideResults();

      // Check TornExchange API status
      this.updateProgress(0, 'Checking TornExchange API...');
      const status = await this.teAPI.getStatus();
      if (!status) {
        throw new Error('TornExchange API is not available');
      }

      // Load or fetch shop data
      this.updateProgress(10, 'Loading shop data...');
      let shopData = this.storage.getCache<ShopData>('shopData');

      if (!shopData) {
        this.updateProgress(15, 'Fetching fresh shop data...');
        shopData = await this.fetchShopData();
        this.storage.setCache('shopData', shopData, 30 * 60 * 1000); // Cache for 30 minutes
      }

      const tradeableItems = this.getTradeableItems(shopData);
      this.updateProgress(20, `Found ${tradeableItems.length} tradeable items`);

      // Analyze all items
      this.results = [];
      const total = tradeableItems.length;

      for (let i = 0; i < total; i++) {
        const item = tradeableItems[i];
        const progress = 20 + (i / total) * 70; // 20-90%
        this.updateProgress(progress, `Analyzing: ${item.name}`);

        try {
          const result = await this.analyzeItem(item.itemId, item);
          this.results.push(result);
        } catch (error) {
          console.error(`Error analyzing item ${item.itemId}:`, error);
          this.results.push({
            itemId: item.itemId,
            name: item.name,
            shopPrice: item.shops[0].price,
            shopName: item.shops[0].shopName,
            bazaarPrice: null,
            profit: null,
            profitMargin: null,
            profitPer100: null,
            maxStock: item.shops[0].stock,
            status: 'Error: ' + (error as Error).message,
          });
        }
      }

      this.updateProgress(100, 'Analysis complete!');
      this.hideProgress();
      this.displayResults();
    } catch (error) {
      this.hideProgress();
      this.showError((error as Error).message);
      console.error('Analysis error:', error);
    }
  }

  private async fetchShopData(): Promise<ShopData> {
    if (!this.tornAPI) throw new Error('No API available');

    const cityShops = await this.tornAPI.getCityShops();
    const items = await this.tornAPI.getItems();

    const shopData: ShopData = {
      lastUpdated: new Date().toISOString(),
      shops: {},
      items: {},
    };

    // Process each shop
    for (const [shopId, shop] of Object.entries(cityShops)) {
      shopData.shops[shopId] = {
        name: shop.name,
        inventory: shop.inventory,
      };

      if (shop.inventory) {
        for (const [itemId, item] of Object.entries(shop.inventory)) {
          if (item.in_stock > 0) {
            const itemData = items[itemId];

            if (!shopData.items[itemId]) {
              shopData.items[itemId] = {
                name: item.name,
                type: itemData ? itemData.type : 'Unknown',
                tradeable: itemData ? itemData.tradeable : false,
                shops: [],
              };
            }

            shopData.items[itemId].shops.push({
              shopId,
              shopName: shop.name,
              price: item.price,
              stock: item.in_stock,
            });
          }
        }
      }
    }

    // Sort shops by price for each item
    for (const itemData of Object.values(shopData.items)) {
      itemData.shops.sort((a, b) => a.price - b.price);
    }

    return shopData;
  }

  private getTradeableItems(
    shopData: ShopData
  ): Array<ShopDataItem & { itemId: string }> {
    return Object.entries(shopData.items)
      .filter(([, item]) => item.tradeable)
      .map(([itemId, item]) => ({
        itemId,
        ...item,
      }));
  }

  private async analyzeItem(
    itemId: string,
    itemData: ShopDataItem & { itemId: string }
  ): Promise<ProfitAnalysisItem> {
    const cheapestShop = itemData.shops[0]; // Already sorted by price

    // Get highest bazaar price from all listings
    const bazaarData = await this.teAPI.getHighestPrice(itemId);

    if (!bazaarData || !bazaarData.price) {
      return {
        itemId,
        name: itemData.name,
        shopPrice: cheapestShop.price,
        shopName: cheapestShop.shopName,
        bazaarPrice: null,
        profit: null,
        profitMargin: null,
        profitPer100: null,
        maxStock: cheapestShop.stock,
        status: 'No Bazaar Data',
      };
    }

    // Use the highest bazaar price as the selling price
    const sellingPrice = bazaarData.price;
    const profit = sellingPrice - cheapestShop.price;
    const profitMargin = (profit / cheapestShop.price) * 100;
    const maxBuy = Math.min(cheapestShop.stock, 100);
    const profitPer100 = profit * maxBuy;

    return {
      itemId,
      name: itemData.name,
      shopPrice: cheapestShop.price,
      shopName: cheapestShop.shopName,
      bazaarPrice: sellingPrice,
      bazaarTrader: bazaarData.trader,
      totalListings: bazaarData.totalListings,
      profit,
      profitMargin,
      profitPer100,
      maxStock: cheapestShop.stock,
      maxBuy,
      status: profit > 0 ? 'Profitable' : 'Loss',
    };
  }

  private displayResults(): void {
    this.sortResults();
    this.updateSortIndicators();
    this.showResults();
    this.updateSummary();
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
    const profitable = this.results.filter((r) => r.status === 'Profitable');
    const avgMargin =
      profitable.length > 0
        ? profitable.reduce((sum, r) => sum + (r.profitMargin || 0), 0) /
          profitable.length
        : 0;
    const totalPotential = profitable.reduce(
      (sum, r) => sum + (r.profitPer100 || 0),
      0
    );

    this.resultsSummary.innerHTML = `
      <div class="summary-item">
        <div class="summary-value">${profitable.length}</div>
        <div class="summary-label">Profitable Items</div>
      </div>
      <div class="summary-item">
        <div class="summary-value">${this.formatPercentage(avgMargin)}</div>
        <div class="summary-label">Avg Margin</div>
      </div>
      <div class="summary-item">
        <div class="summary-value">${this.formatCurrency(totalPotential)}</div>
        <div class="summary-label">Total Potential</div>
      </div>
    `;
  }

  private exportResults(): void {
    const data: ProfitAnalysisResult = {
      timestamp: new Date().toISOString(),
      totalItems: this.results.length,
      profitable: this.results.filter((r) => r.status === 'Profitable').length,
      results: this.results,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `profit-analysis-${
      new Date().toISOString().split('T')[0]
    }.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // UI Helper methods
  private showProgress(): void {
    this.progressSection.classList.remove('hidden');
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

  private updateProgress(percentage: number, text: string): void {
    this.progressFill.style.width = `${percentage}%`;
    this.progressText.textContent = text;
  }

  private showError(message: string): void {
    alert(`Error: ${message}`);
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
    if (value === null) return 'profit-neutral';
    if (value > 0) return 'profit-positive';
    if (value < 0) return 'profit-negative';
    return 'profit-neutral';
  }

  private getStatusClass(status: string): string {
    if (status === 'Profitable') return 'status-profitable';
    if (status === 'Loss') return 'status-loss';
    return 'status-no-data';
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new ProfitAnalyzer();
});
