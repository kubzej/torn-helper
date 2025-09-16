import { TornAPIResponse, TornUser, TornItem, TornShop } from '@/types';

export class TornAPI {
  private readonly baseURL = 'https://api.torn.com';
  private readonly apiKey: string;
  private cache = new Map<string, { data: any; timestamp: number }>();
  private readonly cacheTimeout = 30000; // 30 seconds

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Make a request to the Torn API with caching
   */
  private async makeRequest<T>(endpoint: string): Promise<T> {
    const cacheKey = endpoint;
    const now = Date.now();

    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      if (now - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
    }

    try {
      const url = `${this.baseURL}/${endpoint}&key=${this.apiKey}`;
      console.log(`Fetching: ${endpoint}`);

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: TornAPIResponse = await response.json();

      if (data.error) {
        throw new Error(
          `API Error: ${data.error.error} (Code: ${data.error.code})`
        );
      }

      // Cache the result
      this.cache.set(cacheKey, {
        data,
        timestamp: now,
      });

      return data as T;
    } catch (error) {
      console.error(`API request failed for ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Get current user information
   */
  async getUser(): Promise<TornUser> {
    const response = await this.makeRequest<{ [key: string]: any }>(
      'user?selections=basic'
    );

    // The user data is directly in the response, not nested
    return {
      player_id: response.player_id,
      name: response.name,
      level: response.level,
      honor: response.honor,
      gender: response.gender,
      property: response.property,
      signup: response.signup,
      awards: response.awards,
      friends: response.friends,
      enemies: response.enemies,
      forum_posts: response.forum_posts,
      karma: response.karma,
      age: response.age,
      role: response.role,
      donator: response.donator,
      property_id: response.property_id,
    };
  }

  /**
   * Get all items with their details
   */
  async getItems(): Promise<{ [itemId: string]: TornItem }> {
    const response = await this.makeRequest<{
      items: { [itemId: string]: TornItem };
    }>('torn?selections=items');
    return response.items;
  }

  /**
   * Get city shop prices for all items
   */
  async getCityShops(): Promise<{ [shopId: string]: TornShop }> {
    const response = await this.makeRequest<{
      cityshops: { [shopId: string]: TornShop };
    }>('torn?selections=cityshops');
    return response.cityshops;
  }

  /**
   * Get bazaar prices for a specific item
   */
  async getBazaarPrices(itemId: string): Promise<any[]> {
    try {
      const response = await this.makeRequest<{ bazaar: any[] }>(
        `market/${itemId}?selections=bazaar`
      );
      return response.bazaar || [];
    } catch (error) {
      // Some items might not be available on bazaar
      console.warn(`No bazaar data for item ${itemId}:`, error);
      return [];
    }
  }

  /**
   * Validate API key by making a simple request
   */
  async validateKey(): Promise<boolean> {
    try {
      await this.getUser();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clear API cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
