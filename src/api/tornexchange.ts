import { TornExchangeResponse, TornExchangeListing } from '@/types';

export class TornExchangeAPI {
  private readonly baseURL = 'https://tornexchange.com/api';
  private readonly requestDelay = 6000; // 6 seconds between requests (10 per minute limit)
  private lastRequestTime = 0;

  /**
   * Add delay to respect rate limits (10 requests per minute)
   */
  private async respectRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.requestDelay) {
      const delay = this.requestDelay - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Make a request to TornExchange API with rate limiting
   */
  private async makeRequest<T>(endpoint: string): Promise<T> {
    await this.respectRateLimit();

    try {
      const url = `${this.baseURL}/${endpoint}`;
      console.log(`Fetching from TornExchange: ${endpoint}`);

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limit exceeded');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: TornExchangeResponse = await response.json();

      if (data.status === 'error') {
        if (data.rate_limited) {
          console.warn(`Rate limited! Retry after ${data.retry_after} seconds`);
          throw new Error(`Rate limited: retry after ${data.retry_after}s`);
        }
        throw new Error(data.message || 'API Error');
      }

      return data as T;
    } catch (error) {
      console.error(`TornExchange API request failed for ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Get the best listing (lowest price) for an item
   */
  async getBestListing(itemId: string): Promise<any> {
    try {
      const data = await this.makeRequest<any>(
        `best_listing?item_id=${itemId}`
      );
      return data;
    } catch (error) {
      console.error(`Error fetching best listing for item ${itemId}:`, error);
      return null;
    }
  }

  /**
   * Get all listings for an item
   */
  async getListings(
    itemId: string,
    sortBy: string = 'price',
    order: string = 'asc',
    page: number = 1
  ): Promise<TornExchangeListing[]> {
    try {
      const data = await this.makeRequest<TornExchangeResponse>(
        `listings?item_id=${itemId}&sort_by=${sortBy}&order=${order}&page=${page}`
      );
      return data.data?.listings || [];
    } catch (error) {
      console.error(`Error fetching listings for item ${itemId}:`, error);
      return [];
    }
  }

  /**
   * Get the highest selling price for an item from all bazaar listings
   */
  async getHighestPrice(itemId: string): Promise<{
    price: number;
    trader: string;
    item: string;
    totalListings: number;
  } | null> {
    try {
      const data = await this.makeRequest<TornExchangeResponse>(
        `listings?item_id=${itemId}&sort_by=price&order=desc&page=1`
      );

      if (!data.data?.listings || data.data.listings.length === 0) {
        return null;
      }

      // First listing has the highest price since we sorted by price descending
      const highestListing = data.data.listings[0];

      return {
        price: highestListing.price,
        trader: highestListing.trader,
        item: highestListing.item,
        totalListings: data.data.meta?.total_listings || 0,
      };
    } catch (error) {
      console.error(`Error fetching highest price for item ${itemId}:`, error);
      return null;
    }
  }

  /**
   * Get TE price and Torn price for an item
   */
  async getTEPrice(itemId: string): Promise<any> {
    try {
      const data = await this.makeRequest<any>(`te_price?item_id=${itemId}`);
      return data;
    } catch (error) {
      console.error(`Error fetching TE price for item ${itemId}:`, error);
      return null;
    }
  }

  /**
   * Check API status
   */
  async getStatus(): Promise<any> {
    try {
      const data = await this.makeRequest<any>('status');
      return data;
    } catch (error) {
      console.error(`Error checking API status:`, error);
      return null;
    }
  }
}
