const axios = require('axios');
require('dotenv').config();

class TornAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://api.torn.com';
    this.cache = new Map();
    this.cacheTimeout = 30000; // 30 seconds to respect API cache
  }

  /**
   * Make a request to the Torn API with caching
   */
  async makeRequest(endpoint) {
    const cacheKey = endpoint;
    const now = Date.now();

    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (now - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
    }

    try {
      const url = `${this.baseURL}/${endpoint}&key=${this.apiKey}`;
      console.log(`Fetching: ${endpoint}`);

      const response = await axios.get(url);

      if (response.data.error) {
        throw new Error(
          `API Error: ${response.data.error.error} - Code ${response.data.error.code} - Endpoint: ${endpoint}`
        );
      }

      // Cache the result
      this.cache.set(cacheKey, {
        data: response.data,
        timestamp: now,
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        console.error(
          `API request failed: ${error.response.status} ${error.response.statusText}`
        );
        if (error.response.data && error.response.data.error) {
          console.error(`Error details: ${error.response.data.error.error}`);
        }
      } else {
        console.error(`Request failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get all items with their details
   */
  async getItems() {
    const data = await this.makeRequest('torn?selections=items');
    return data.items;
  }

  /**
   * Get city shop prices for all items
   */
  async getCityShops() {
    const data = await this.makeRequest('torn?selections=cityshops');
    return data.cityshops;
  }

  /**
   * Get bazaar prices for a specific item
   */
  async getBazaarPrices(itemId) {
    try {
      const data = await this.makeRequest(`market/${itemId}?selections=bazaar`);
      return data.bazaar || [];
    } catch (error) {
      // Some items might not be available on bazaar
      return [];
    }
  }
}

module.exports = TornAPI;
