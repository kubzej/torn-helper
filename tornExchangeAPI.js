const axios = require('axios');

class TornExchangeAPI {
  constructor() {
    this.baseURL = 'https://tornexchange.com/api';
    this.requestDelay = 6000; // 6 seconds between requests (10 per minute limit)
    this.lastRequestTime = 0;
  }

  /**
   * Add delay to respect rate limits (10 requests per minute)
   */
  async respectRateLimit() {
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
  async makeRequest(endpoint) {
    await this.respectRateLimit();

    try {
      const url = `${this.baseURL}/${endpoint}`;
      console.log(`Fetching from TornExchange: ${endpoint}`);

      const response = await axios.get(url);

      if (response.data.status === 'error') {
        if (response.data.rate_limited) {
          console.warn(
            `Rate limited! Retry after ${response.data.retry_after} seconds`
          );
          throw new Error(
            `Rate limited: retry after ${response.data.retry_after}s`
          );
        }
        throw new Error(response.data.message || 'API Error');
      }

      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 429) {
        console.warn('Rate limit exceeded');
        throw new Error('Rate limit exceeded');
      }
      throw error;
    }
  }

  /**
   * Get the best listing (lowest price) for an item
   */
  async getBestListing(itemId) {
    try {
      const data = await this.makeRequest(`best_listing?item_id=${itemId}`);
      return data;
    } catch (error) {
      console.error(
        `Error fetching best listing for item ${itemId}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Get all listings for an item
   */
  async getListings(itemId, sortBy = 'price', order = 'asc', page = 1) {
    try {
      const data = await this.makeRequest(
        `listings?item_id=${itemId}&sort_by=${sortBy}&order=${order}&page=${page}`
      );
      return data.data?.listings || [];
    } catch (error) {
      console.error(
        `Error fetching listings for item ${itemId}: ${error.message}`
      );
      return [];
    }
  }

  /**
   * Get the highest selling price for an item from all bazaar listings
   */
  async getHighestPrice(itemId) {
    try {
      const data = await this.makeRequest(
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
      console.error(
        `Error fetching highest price for item ${itemId}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Get TE price and Torn price for an item
   */
  async getTEPrice(itemId) {
    try {
      const data = await this.makeRequest(`te_price?item_id=${itemId}`);
      return data;
    } catch (error) {
      console.error(
        `Error fetching TE price for item ${itemId}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Check API status
   */
  async getStatus() {
    try {
      const data = await this.makeRequest('status');
      return data;
    } catch (error) {
      console.error(`Error checking API status: ${error.message}`);
      return null;
    }
  }
}

module.exports = TornExchangeAPI;
