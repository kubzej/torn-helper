import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple implementations of the API classes for Node.js environment
class TornAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.torn.com';
  }

  async makeRequest(endpoint) {
    const url = `${this.baseUrl}${endpoint}&key=${this.apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }

  async getCityShops() {
    return await this.makeRequest('/city?selections=shops');
  }

  async getItems() {
    return await this.makeRequest('/torn?selections=items');
  }
}

class TornExchangeAPI {
  constructor() {
    this.baseUrl = 'https://api.tornexchange.com';
    this.requestCount = 0;
    this.requestWindow = 60000; // 1 minute in milliseconds
    this.maxRequests = 10; // Maximum 10 requests per minute
    this.requestTimes = [];
  }

  async makeRequest(endpoint) {
    // Implement rate limiting
    await this.waitForRateLimit();

    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url);

      // Track successful request
      this.requestTimes.push(Date.now());

      if (!response.ok) {
        if (response.status === 429) {
          console.warn('Rate limit exceeded, waiting before retry...');
          await new Promise((resolve) => setTimeout(resolve, 15000)); // Wait 15 seconds on 429
          return this.makeRequest(endpoint); // Retry
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED' ||
        error.message.includes('fetch failed')
      ) {
        console.error(
          `TornExchange API network error for ${endpoint}: ${error.message}`
        );
        console.error(
          'This might be a temporary network issue or the API might be down.'
        );
      } else {
        console.error(`TornExchange API error for ${endpoint}:`, error.message);
      }
      throw error;
    }
  }

  async waitForRateLimit() {
    const now = Date.now();

    // Remove requests older than 1 minute
    this.requestTimes = this.requestTimes.filter(
      (time) => now - time < this.requestWindow
    );

    // If we're at the limit, wait until we can make another request
    if (this.requestTimes.length >= this.maxRequests) {
      const oldestRequest = this.requestTimes[0];
      const waitTime = this.requestWindow - (now - oldestRequest) + 1000; // Add 1 second buffer

      if (waitTime > 0) {
        console.log(
          `Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)} seconds...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.waitForRateLimit(); // Check again after waiting
      }
    }
  }
  async getStatus() {
    try {
      console.log('Attempting to connect to TornExchange API...');
      await this.makeRequest('/status');
      return true;
    } catch (error) {
      console.log('TornExchange API status check failed:', error.message);
      return false;
    }
  }

  async getHighestPrice(itemId) {
    try {
      const data = await this.makeRequest(
        `/api/v1/bazaar/${itemId}/highest-price`
      );
      return data?.highest_price || null;
    } catch (error) {
      console.warn(
        `Failed to get highest price for item ${itemId}:`,
        error.message
      );
      return null;
    }
  }
}

// Main data fetching function
async function fetchMarketData() {
  const apiKey = process.env.TORN_API_KEY;
  if (!apiKey) {
    throw new Error('TORN_API_KEY environment variable is required');
  }

  console.log('Starting market data fetch...');

  const tornAPI = new TornAPI(apiKey);
  const teAPI = new TornExchangeAPI();

  // Check TornExchange API status
  console.log('Checking TornExchange API status...');
  try {
    const status = await teAPI.getStatus();
    if (!status) {
      console.warn(
        'TornExchange API status check failed, but continuing anyway...'
      );
    } else {
      console.log('TornExchange API is available ✓');
    }
  } catch (error) {
    console.warn('TornExchange API status check error:', error.message);
    console.warn('Continuing with data fetch anyway...');
  }

  // Fetch shop data
  console.log('Fetching city shop data...');
  const cityShops = await tornAPI.getCityShops();
  const items = await tornAPI.getItems();

  const shopData = {
    lastUpdated: new Date().toISOString(),
    shops: {},
    items: {},
  };

  // Process each shop
  console.log('Processing shop inventories...');
  for (const [shopId, shop] of Object.entries(cityShops.shops || {})) {
    shopData.shops[shopId] = {
      name: shop.name,
      inventory: shop.inventory,
    };

    if (shop.inventory) {
      for (const [itemId, item] of Object.entries(shop.inventory)) {
        if (item.in_stock > 0) {
          const itemData = items.items?.[itemId];

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

  console.log('Calculating profit analysis...');

  // Get tradeable items and analyze profits
  const tradeableItems = Object.entries(shopData.items)
    .filter(([, item]) => item.tradeable)
    .map(([itemId, item]) => ({ itemId, ...item }));

  console.log(`Found ${tradeableItems.length} tradeable items`);

  const results = [];
  let processed = 0;

  for (const item of tradeableItems) {
    processed++;
    if (processed % 10 === 0) {
      console.log(`Processing item ${processed}/${tradeableItems.length}`);
    }

    const cheapestShop = item.shops[0];
    if (!cheapestShop) continue;

    let bazaarPrice = null;
    try {
      bazaarPrice = await teAPI.getHighestPrice(item.itemId);
    } catch (error) {
      console.warn(
        `Failed to get bazaar price for ${item.name}:`,
        error.message
      );
      // Continue with null bazaar price
    }

    const analysisItem = {
      itemId: item.itemId,
      name: item.name,
      shopPrice: cheapestShop.price,
      bazaarPrice: bazaarPrice,
      profit: bazaarPrice ? bazaarPrice - cheapestShop.price : null,
      profitMargin: bazaarPrice
        ? ((bazaarPrice - cheapestShop.price) / cheapestShop.price) * 100
        : null,
      profitPer100: bazaarPrice
        ? (bazaarPrice - cheapestShop.price) * 100
        : null,
      maxStock: cheapestShop.stock,
      status:
        bazaarPrice && bazaarPrice > cheapestShop.price
          ? 'Profitable'
          : bazaarPrice
          ? 'Not Profitable'
          : 'Unknown',
      shopName: cheapestShop.shopName,
    };

    results.push(analysisItem);
  }

  // Sort by profit margin (highest first)
  results.sort((a, b) => (b.profitMargin || 0) - (a.profitMargin || 0));

  const profitableCount = results.filter(
    (r) => r.status === 'Profitable'
  ).length;
  const unknownCount = results.filter((r) => r.status === 'Unknown').length;

  const finalData = {
    lastUpdated: new Date().toISOString(),
    totalItems: results.length,
    profitableItems: profitableCount,
    unknownItems: unknownCount,
    results: results,
  };

  console.log(`\nProcessing complete!`);
  console.log(`- Total items processed: ${results.length}`);
  console.log(`- Profitable items: ${profitableCount}`);
  console.log(`- Items with unknown bazaar prices: ${unknownCount}`);

  // Ensure output directory exists
  const outputDir = path.join(process.cwd(), 'public', 'data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write the data
  const outputPath = path.join(outputDir, 'profit-analysis.json');

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`Created output directory: ${outputDir}`);
  }

  fs.writeFileSync(outputPath, JSON.stringify(finalData, null, 2));

  console.log(`Market data successfully saved to ${outputPath}`);
  console.log(`Total items: ${finalData.totalItems}`);
  console.log(`Profitable items: ${finalData.profitableItems}`);

  return finalData;
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchMarketData()
    .then(() => {
      console.log('Market data fetch completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error fetching market data:', error);
      process.exit(1);
    });
}

export { fetchMarketData };
