import { TornAPIResponse, TornUser, TornItem, TornShop } from '@/types';

export class TornAPI {
  private readonly baseURL = 'https://api.torn.com/v2';
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
      const url = `${this.baseURL}/${endpoint}${
        endpoint.includes('?') ? '&' : '?'
      }key=${this.apiKey}`;
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
  async getProfile(): Promise<TornUser> {
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
      await this.getProfile();
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

  /**
   * Get property types
   */
  async getPropertyTypes(): Promise<{ [key: string]: any }> {
    const response = await this.makeRequest<{
      properties: { [propertyId: string]: any };
    }>('torn?selections=properties');
    return response.properties;
  }

  /**
   * Get property rental listings for a specific property type
   */
  async getPropertyListings(
    propertyTypeId: number,
    options: {
      offset?: number;
      limit?: number;
      sort?: 'DESC' | 'ASC';
      timestamp?: string;
    } = {}
  ): Promise<any> {
    const { offset = 0, limit = 100, sort = 'DESC', timestamp } = options;

    // Ensure limit doesn't exceed 100 (API maximum)
    const apiLimit = Math.min(limit, 100);

    // Build query parameters
    const params = new URLSearchParams({
      offset: offset.toString(),
      limit: apiLimit.toString(),
      sort,
    });

    if (timestamp) {
      params.append('timestamp', timestamp);
    }

    const endpoint = `market/${propertyTypeId}/rentals?${params.toString()}`;

    console.log(`Fetching property rentals: ${endpoint}`);

    const response = await this.makeRequest<{
      rentals: {
        listings: Array<{
          happy: number;
          cost: number;
          cost_per_day: number;
          rental_period: number;
          market_price: number;
          upkeep: number;
          modifications: string[];
        }>;
        property: {
          id: number;
          name: string;
        };
      };
      _metadata: {
        links: {
          next?: string;
          prev?: string;
        };
      };
    }>(endpoint);

    return response;
  }
  /**
   * Get rental listings for all property types or a specific type
   */
  async getRentalListings(
    propertyTypeId?: number,
    options: {
      offset?: number;
      limit?: number;
      sort?: 'DESC' | 'ASC';
    } = {}
  ): Promise<any[]> {
    if (propertyTypeId) {
      const response = await this.getPropertyListings(propertyTypeId, options);
      return response.rentals?.listings || [];
    }

    // Get property types first
    const propertyTypes = await this.getPropertyTypes();
    console.log('Available property types:', Object.keys(propertyTypes));

    // Get all property type IDs
    const allPropertyTypeIds = Object.keys(propertyTypes).map((id) =>
      parseInt(id)
    );
    const allRentals: any[] = [];

    for (const typeId of allPropertyTypeIds) {
      try {
        const response = await this.getPropertyListings(typeId, {
          ...options,
          limit: 100, // Get more data for testing
        });

        // Log the full response structure to debug
        console.log(
          `Full response for property type ${typeId}:`,
          JSON.stringify(response, null, 2)
        );
        console.log(`Response keys:`, Object.keys(response));

        if (response.rentals) {
          console.log(`Rentals object exists:`, Object.keys(response.rentals));
          if (response.rentals.listings) {
            console.log(
              `Listings array exists with length:`,
              response.rentals.listings.length
            );
          } else {
            console.log(`No listings array found in rentals`);
          }
        } else {
          console.log(`No rentals object found in response`);
        }

        if (response.rentals?.listings) {
          console.log(
            `Property type ${typeId} returned ${response.rentals.listings.length} listings`
          );

          // Add property type info to each listing
          const listingsWithType = response.rentals.listings.map(
            (listing: any) => ({
              ...listing,
              property: {
                id: response.rentals.property.id,
                name: response.rentals.property.name,
              },
            })
          );

          allRentals.push(...listingsWithType);
        } else {
          console.log(`No valid listings found for property type ${typeId}`);
        }
      } catch (error) {
        console.warn(
          `Failed to fetch listings for property type ${typeId}:`,
          error
        );
      }
    }

    console.log(`Total rentals fetched: ${allRentals.length}`);
    return allRentals;
  }
}
