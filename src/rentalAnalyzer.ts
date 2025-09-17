import { RentalData, RentalFilters } from '@/types';
import { StorageManager } from './storage';
import { TornAPI } from './api/torn';

class RentalAnalyzer {
  private storage: StorageManager;
  private tornAPI: TornAPI | null = null;
  private allRentals: RentalData[] = [];
  private filteredRentals: RentalData[] = [];

  // DOM elements
  private progressSection: HTMLElement;
  private resultsSection: HTMLElement;
  private errorSection: HTMLElement;

  // Filter controls
  private propertyTypeSelect: HTMLSelectElement;
  private minHappinessInput: HTMLInputElement;
  private maxCostPerDayInput: HTMLInputElement;
  private minRentalPeriodInput: HTMLInputElement;
  private maxRentalPeriodInput: HTMLInputElement;
  private fetchRentalsBtn: HTMLButtonElement;
  private clearFiltersBtn: HTMLButtonElement;

  // Results controls
  private rentalsTable: HTMLTableElement;
  private rentalsTableBody: HTMLElement;
  private resultsSummary: HTMLElement;
  private progressFill: HTMLElement;
  private progressText: HTMLElement;
  private errorMessage: HTMLElement;
  private retryBtn: HTMLButtonElement;

  // Sorting state
  private currentSort: {
    column: keyof RentalData | 'name' | 'modifications';
    direction: 'asc' | 'desc';
  } = { column: 'happy', direction: 'desc' };
  constructor() {
    this.storage = new StorageManager();
    this.initializeDOM();
    this.attachEventListeners();
    this.checkApiKey();
  }

  // ===== INITIALIZATION =====

  private initializeDOM(): void {
    // Main sections
    this.progressSection = document.getElementById('progressSection')!;
    this.resultsSection = document.getElementById('resultsSection')!;
    this.errorSection = document.getElementById('errorSection')!;

    // Filter controls
    this.propertyTypeSelect = document.getElementById(
      'propertyTypeSelect'
    ) as HTMLSelectElement;
    this.minHappinessInput = document.getElementById(
      'minHappiness'
    ) as HTMLInputElement;
    this.maxCostPerDayInput = document.getElementById(
      'maxCostPerDay'
    ) as HTMLInputElement;
    this.minRentalPeriodInput = document.getElementById(
      'minRentalPeriod'
    ) as HTMLInputElement;
    this.maxRentalPeriodInput = document.getElementById(
      'maxRentalPeriod'
    ) as HTMLInputElement;
    this.fetchRentalsBtn = document.getElementById(
      'fetchRentalsBtn'
    ) as HTMLButtonElement;
    this.clearFiltersBtn = document.getElementById(
      'clearFiltersBtn'
    ) as HTMLButtonElement;

    // Results controls
    this.rentalsTable = document.getElementById(
      'rentalsTable'
    ) as HTMLTableElement;
    this.rentalsTableBody = document.getElementById('rentalsTableBody')!;
    this.resultsSummary = document.getElementById('resultsSummary')!;
    this.progressFill = document.getElementById('progressFill')!;
    this.progressText = document.getElementById('progressText')!;
    this.errorMessage = document.getElementById('errorMessage')!;
    this.retryBtn = document.getElementById('retryBtn') as HTMLButtonElement;
  }

  private attachEventListeners(): void {
    this.fetchRentalsBtn.addEventListener('click', () =>
      this.handleFetchRentals()
    );
    this.clearFiltersBtn.addEventListener('click', () => this.clearFilters());
    this.retryBtn.addEventListener('click', () => this.handleFetchRentals());

    // Add click listeners to sortable table headers
    this.rentalsTable.querySelectorAll('th.sortable').forEach((header) => {
      header.addEventListener('click', () => {
        const sortColumn = header.getAttribute('data-sort') as
          | keyof RentalData
          | 'name'
          | 'modifications';
        this.handleHeaderClick(sortColumn);
      });
    });

    // Real-time filtering when filters change
    [
      this.propertyTypeSelect,
      this.minHappinessInput,
      this.maxCostPerDayInput,
      this.minRentalPeriodInput,
      this.maxRentalPeriodInput,
    ].forEach((element) => {
      element.addEventListener('input', () => this.applyFilters());
    });
  }

  private async checkApiKey(): Promise<void> {
    const storedKey = this.storage.getApiKey();
    if (!storedKey) {
      this.showError(
        'No API key found. Please go back to the dashboard and set up your API key.'
      );
      return;
    }

    this.tornAPI = new TornAPI(storedKey.key);

    try {
      const isValid = await this.tornAPI.validateKey();
      if (!isValid) {
        this.showError(
          'Invalid API key. Please go back to the dashboard and update your API key.'
        );
        return;
      }
    } catch (error) {
      this.showError(
        'Failed to validate API key. Please check your internet connection and try again.'
      );
      return;
    }
  }

  // ===== DATA FETCHING =====

  private async handleFetchRentals(): Promise<void> {
    if (!this.tornAPI) {
      this.showError('API not initialized. Please refresh the page.');
      return;
    }

    this.showProgress();
    this.updateProgress(0, 'Fetching property data...');

    try {
      // Get selected property type
      const selectedPropertyType = this.propertyTypeSelect.value;

      let allRentalsData: RentalData[] = [];

      if (selectedPropertyType) {
        // Fetch specific property type
        const propertyTypeId = parseInt(selectedPropertyType);
        const response = await this.tornAPI.getPropertyListings(propertyTypeId);
        this.updateProgress(50, 'Processing rental data...');

        // Process the rental data with property info
        allRentalsData = this.processRentalData(
          response.rentals.listings,
          response.rentals.property
        );
      } else {
        // Fetch all property types
        const rentals = await this.tornAPI.getRentalListings();
        this.updateProgress(50, 'Processing rental data...');
        allRentalsData = this.processRentalData(rentals);
      }

      this.allRentals = allRentalsData;
      this.updateProgress(100, 'Analysis complete!');

      setTimeout(() => {
        this.applyFilters();
        this.showResults();
      }, 500);
    } catch (error) {
      console.error('Failed to fetch rental data:', error);
      this.showError(
        `Failed to fetch rental data: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  private processRentalData(rentals: any[], propertyInfo?: any): RentalData[] {
    return rentals.map((rental) => ({
      happy: rental.happy,
      cost: rental.cost,
      cost_per_day: rental.cost_per_day,
      rental_period: rental.rental_period,
      market_price: rental.market_price,
      upkeep: rental.upkeep,
      modifications: rental.modifications || [],
      property: rental.property || propertyInfo || { id: 0, name: 'Unknown' },
    }));
  }

  // ===== FILTERING & SORTING =====

  private applyFilters(): void {
    if (this.allRentals.length === 0) return;

    const filters = this.getFilters();

    this.filteredRentals = this.allRentals.filter((rental) => {
      // Property type filter
      if (
        filters.propertyType &&
        rental.property?.id?.toString() !== filters.propertyType
      ) {
        return false;
      }

      // Minimum happiness filter
      if (filters.minHappiness > 0 && rental.happy < filters.minHappiness) {
        return false;
      }

      // Cost per day filter
      if (
        filters.maxCostPerDay > 0 &&
        rental.cost_per_day > filters.maxCostPerDay
      ) {
        return false;
      }

      // Rental period filters
      if (
        filters.minRentalPeriod > 0 &&
        rental.rental_period < filters.minRentalPeriod
      ) {
        return false;
      }

      if (
        filters.maxRentalPeriod > 0 &&
        rental.rental_period > filters.maxRentalPeriod
      ) {
        return false;
      }

      return true;
    });

    this.applySorting();
    this.updateResultsTable();
    this.updateSortIndicators();
    this.updateSummary();
  }

  private getFilters(): RentalFilters {
    const propertyTypeValue = this.propertyTypeSelect.value;

    return {
      propertyType: propertyTypeValue || '',
      minHappiness: parseInt(this.minHappinessInput.value) || 0,
      maxCostPerDay: parseInt(this.maxCostPerDayInput.value) || 0,
      minRentalPeriod: parseInt(this.minRentalPeriodInput.value) || 0,
      maxRentalPeriod: parseInt(this.maxRentalPeriodInput.value) || 0,
    };
  }

  private clearFilters(): void {
    this.propertyTypeSelect.value = '';
    this.minHappinessInput.value = '';
    this.maxCostPerDayInput.value = '';
    this.minRentalPeriodInput.value = '';
    this.maxRentalPeriodInput.value = '';

    if (this.allRentals.length > 0) {
      this.applyFilters();
    }
  }

  private handleHeaderClick(
    column: keyof RentalData | 'name' | 'modifications'
  ): void {
    // Toggle direction if same column, otherwise use desc for new column
    if (this.currentSort.column === column) {
      this.currentSort.direction =
        this.currentSort.direction === 'desc' ? 'asc' : 'desc';
    } else {
      this.currentSort.column = column;
      this.currentSort.direction = 'desc';
    }

    this.applySorting();
    this.updateResultsTable();
    this.updateSortIndicators();
  }

  private updateSortIndicators(): void {
    // Remove all active states
    this.rentalsTable.querySelectorAll('th.sortable').forEach((header) => {
      header.classList.remove('active', 'asc', 'desc');
    });

    // Add active state to current sort column
    const activeHeader = this.rentalsTable.querySelector(
      `th[data-sort="${this.currentSort.column}"]`
    );
    if (activeHeader) {
      activeHeader.classList.add('active', this.currentSort.direction);
    }
  }

  private applySorting(): void {
    this.filteredRentals.sort((a, b) => {
      let aVal: any, bVal: any;

      switch (this.currentSort.column) {
        case 'happy':
          aVal = a.happy;
          bVal = b.happy;
          break;
        case 'cost_per_day':
          aVal = a.cost_per_day;
          bVal = b.cost_per_day;
          break;
        case 'cost':
          aVal = a.cost;
          bVal = b.cost;
          break;
        case 'rental_period':
          aVal = a.rental_period;
          bVal = b.rental_period;
          break;
        case 'name':
          aVal = a.property?.name?.toLowerCase() || '';
          bVal = b.property?.name?.toLowerCase() || '';
          break;
        case 'modifications':
          aVal = a.modifications?.join(', ')?.toLowerCase() || '';
          bVal = b.modifications?.join(', ')?.toLowerCase() || '';
          break;
        default:
          return 0;
      }

      if (this.currentSort.direction === 'asc') {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });
  }

  // ===== UI UPDATES =====

  private updateResultsTable(): void {
    this.rentalsTableBody.innerHTML = '';

    this.filteredRentals.forEach((rental) => {
      const row = document.createElement('tr');
      const modificationsText =
        rental.modifications && rental.modifications.length > 0
          ? rental.modifications.join(', ')
          : 'None';

      row.innerHTML = `
        <td class="property-type">${rental.property?.name || 'Unknown'}</td>
        <td class="happiness">${rental.happy?.toLocaleString() || '0'}</td>
        <td class="cost-per-day">$${
          rental.cost_per_day?.toLocaleString() || '0'
        }</td>
        <td class="total-cost">$${rental.cost?.toLocaleString() || '0'}</td>
        <td class="rental-period">${rental.rental_period || '0'} days</td>
        <td class="modifications" title="${modificationsText}">${modificationsText}</td>
      `;
      this.rentalsTableBody.appendChild(row);
    });
  }

  private updateSummary(): void {
    const total = this.filteredRentals.length;
    const available = total; // All listed rentals are available

    if (total === 0) {
      this.resultsSummary.innerHTML =
        '<p>No rentals match your criteria. Try adjusting your filters.</p>';
      return;
    }

    const avgHappiness =
      this.filteredRentals.reduce((sum, r) => sum + r.happy, 0) / total;
    const avgCost =
      this.filteredRentals.reduce((sum, r) => sum + r.cost_per_day, 0) / total;
    const now = new Date().toLocaleString();

    this.resultsSummary.innerHTML = `
      <div class="summary-item">
        <span class="summary-label">Total Properties:</span>
        <span class="summary-value">${total}</span>
        ${
          total >= 100
            ? '<small style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 2px;">API limit reached - more may be available</small>'
            : ''
        }
      </div>
      <div class="summary-item">
        <span class="summary-label">Available:</span>
        <span class="summary-value">${available}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Avg Happiness:</span>
        <span class="summary-value">${Math.round(
          avgHappiness
        ).toLocaleString()}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Avg Cost/Day:</span>
        <span class="summary-value">$${Math.round(
          avgCost
        ).toLocaleString()}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Last Updated:</span>
        <span class="summary-value">${now}</span>
      </div>
    `;
  }

  // ===== SECTION MANAGEMENT =====

  private updateProgress(percentage: number, text: string): void {
    this.progressFill.style.width = `${percentage}%`;
    this.progressText.textContent = text;
  }

  private showProgress(): void {
    this.hideAllSections();
    this.progressSection.classList.remove('hidden');
  }

  private showResults(): void {
    this.hideAllSections();
    this.resultsSection.classList.remove('hidden');
  }

  private showError(message: string): void {
    this.hideAllSections();
    this.errorMessage.textContent = message;
    this.errorSection.classList.remove('hidden');
  }

  private hideAllSections(): void {
    this.progressSection.classList.add('hidden');
    this.resultsSection.classList.add('hidden');
    this.errorSection.classList.add('hidden');
  }
}

// Initialize the rental analyzer when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new RentalAnalyzer();
});
