import { UseCase, APIKeyValidationResult } from '@/types';
import { StorageManager } from './storage';
import { TornAPI } from './api/torn';

class TornHelperApp {
  private storage: StorageManager;

  // DOM elements
  private apiKeySection: HTMLElement;
  private dashboard: HTMLElement;
  private apiKeyInput: HTMLInputElement;
  private confirmApiKeyBtn: HTMLButtonElement;
  private changeApiKeyBtn: HTMLButtonElement;
  private useCasesGrid: HTMLElement;
  private loadingOverlay: HTMLElement;

  // Use cases configuration
  private useCases: UseCase[] = [
    {
      id: 'profit-analyzer',
      title: '💰 Profit Analyzer',
      description:
        'Compare city shop prices with bazaar prices to find profitable trading opportunities. Analyze all tradeable items and calculate profit margins.',
      icon: '📊',
      status: 'ready',
      route: '/analyzer.html',
    },
    {
      id: 'future-use-cases',
      title: 'Anything you would want to add?',
      description: 'Let me know your ideas!',
      icon: '🛡️',
      status: 'coming-soon',
      route: '#',
      disabled: true,
    },
  ];

  constructor() {
    this.storage = new StorageManager();
    this.initializeDOM();
    this.attachEventListeners();
    this.checkExistingApiKey();
  }

  private initializeDOM(): void {
    this.apiKeySection = document.getElementById('apiKeySection')!;
    this.dashboard = document.getElementById('dashboard')!;
    this.apiKeyInput = document.getElementById(
      'apiKeyInput'
    ) as HTMLInputElement;
    this.confirmApiKeyBtn = document.getElementById(
      'confirmApiKey'
    ) as HTMLButtonElement;
    this.changeApiKeyBtn = document.getElementById(
      'changeApiKey'
    ) as HTMLButtonElement;
    this.useCasesGrid = document.getElementById('useCasesGrid')!;
    this.loadingOverlay = document.getElementById('loadingOverlay')!;
  }

  private attachEventListeners(): void {
    this.confirmApiKeyBtn.addEventListener('click', () =>
      this.handleApiKeyConfirm()
    );
    this.changeApiKeyBtn.addEventListener('click', () =>
      this.handleChangeApiKey()
    );

    this.apiKeyInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleApiKeyConfirm();
      }
    });

    this.apiKeyInput.addEventListener('input', () => {
      const hasValue = this.apiKeyInput.value.trim().length > 0;
      this.confirmApiKeyBtn.disabled = !hasValue;
    });
  }

  private async checkExistingApiKey(): Promise<void> {
    const storedKey = this.storage.getApiKey();
    if (storedKey) {
      // Validate the stored key
      const validation = await this.validateApiKey(storedKey.key);
      if (validation.valid) {
        this.showDashboard();
        this.renderUseCases();
      } else {
        // Key is invalid, remove it and show input
        this.storage.removeApiKey();
        this.showApiKeyInput();
      }
    } else {
      this.showApiKeyInput();
    }
  }

  private async handleApiKeyConfirm(): Promise<void> {
    const apiKey = this.apiKeyInput.value.trim();
    if (!apiKey) return;

    this.showLoading('Validating API key...');

    try {
      const validation = await this.validateApiKey(apiKey);

      if (validation.valid && validation.user) {
        // Store the API key
        this.storage.setApiKey(apiKey, validation.user);

        this.hideLoading();
        this.showDashboard();
        this.renderUseCases();
      } else {
        this.hideLoading();
        this.showError(validation.error || 'Invalid API key');
      }
    } catch (error) {
      this.hideLoading();
      this.showError('Failed to validate API key. Please try again.');
      console.error('API validation error:', error);
    }
  }

  private async validateApiKey(
    apiKey: string
  ): Promise<APIKeyValidationResult> {
    try {
      const tempAPI = new TornAPI(apiKey);
      const user = await tempAPI.getUser();

      return {
        valid: true,
        user: user,
      };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message || 'Invalid API key',
      };
    }
  }

  private handleChangeApiKey(): void {
    this.storage.removeApiKey();
    this.apiKeyInput.value = '';
    this.showApiKeyInput();
  }

  private showApiKeyInput(): void {
    this.apiKeySection.classList.remove('hidden');
    this.dashboard.classList.add('hidden');
    this.apiKeyInput.focus();
  }

  private showDashboard(): void {
    this.apiKeySection.classList.add('hidden');
    this.dashboard.classList.remove('hidden');
  }

  private showLoading(text: string = 'Loading...'): void {
    const loadingText = this.loadingOverlay.querySelector(
      '.loading-text'
    ) as HTMLElement;
    loadingText.textContent = text;
    this.loadingOverlay.classList.remove('hidden');
  }

  private hideLoading(): void {
    this.loadingOverlay.classList.add('hidden');
  }

  private showError(message: string): void {
    // Simple error display - could be enhanced with a proper modal/toast
    alert(`Error: ${message}`);
  }

  private renderUseCases(): void {
    this.useCasesGrid.innerHTML = '';

    this.useCases.forEach((useCase) => {
      const tile = this.createUseCaseTile(useCase);
      this.useCasesGrid.appendChild(tile);
    });
  }

  private createUseCaseTile(useCase: UseCase): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'use-case-tile';

    if (useCase.disabled) {
      tile.style.opacity = '0.6';
      tile.style.cursor = 'not-allowed';
    }

    tile.innerHTML = `
      <div class="use-case-icon">${useCase.icon}</div>
      <h3 class="use-case-title">${useCase.title}</h3>
      <p class="use-case-description">${useCase.description}</p>
      <div class="use-case-status status-${useCase.status}">
        ${this.getStatusText(useCase.status)}
      </div>
    `;

    if (!useCase.disabled) {
      tile.addEventListener('click', () => {
        if (useCase.route.startsWith('#')) {
          // Handle coming soon items
          this.showComingSoonDialog(useCase);
        } else {
          // Navigate to the use case page
          window.location.href = useCase.route;
        }
      });
    }

    return tile;
  }

  private showComingSoonDialog(useCase: UseCase): void {
    const message = `🚧 ${useCase.title} - Coming Soon!\n\n${useCase.description}\n\nThis feature is currently in development and will be available in a future update. Stay tuned!`;
    alert(message);
  }

  private getStatusText(status: UseCase['status']): string {
    switch (status) {
      case 'ready':
        return '✅ Ready';
      case 'beta':
        return '🧪 Beta';
      case 'coming-soon':
        return '🔜 Coming Soon';
      default:
        return status;
    }
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new TornHelperApp();
});
