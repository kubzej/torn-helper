const fs = require('fs');
const path = require('path');
const TornAPI = require('./tornAPI');
const chalk = require('chalk');
require('dotenv').config();

class ShopDataManager {
  constructor() {
    this.dataFile = path.join(__dirname, 'shop-data.json');
    this.api = null;
  }

  /**
   * Initialize API
   */
  init() {
    const apiKey = process.env.TORN_API_KEY;
    if (!apiKey || apiKey === 'your_api_key_here') {
      throw new Error('Please set your TORN_API_KEY in the .env file');
    }
    this.api = new TornAPI(apiKey);
  }

  /**
   * Fetch and save current shop data
   */
  async saveShopData() {
    console.log(chalk.blue('📦 Fetching city shop data...'));

    const cityShops = await this.api.getCityShops();
    const items = await this.api.getItems();

    const shopData = {
      lastUpdated: new Date().toISOString(),
      shops: {},
      items: {},
    };

    // Process each shop
    for (const [shopId, shop] of Object.entries(cityShops)) {
      shopData.shops[shopId] = {
        name: shop.name,
        items: {},
      };

      if (shop.inventory) {
        for (const [itemId, item] of Object.entries(shop.inventory)) {
          if (item.in_stock > 0) {
            const itemData = items[itemId];

            shopData.shops[shopId].items[itemId] = {
              name: item.name,
              price: item.price,
              stock: item.in_stock,
            };

            // Also store in items index
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

    // Save to file
    fs.writeFileSync(this.dataFile, JSON.stringify(shopData, null, 2));

    const totalItems = Object.keys(shopData.items).length;
    const tradeableItems = Object.values(shopData.items).filter(
      (item) => item.tradeable
    ).length;

    console.log(chalk.green(`✅ Shop data saved to ${this.dataFile}`));
    console.log(chalk.white(`📊 Total items: ${totalItems}`));
    console.log(chalk.white(`🔄 Tradeable items: ${tradeableItems}`));

    return shopData;
  }

  /**
   * Load shop data from file
   */
  loadShopData() {
    if (!fs.existsSync(this.dataFile)) {
      throw new Error(`Shop data file not found: ${this.dataFile}`);
    }

    const data = fs.readFileSync(this.dataFile, 'utf8');
    return JSON.parse(data);
  }

  /**
   * Get cheapest shop price for an item
   */
  getCheapestPrice(itemId, shopData = null) {
    if (!shopData) {
      shopData = this.loadShopData();
    }

    const item = shopData.items[itemId];
    if (!item || !item.shops.length) {
      return null;
    }

    return item.shops[0]; // Already sorted by price
  }

  /**
   * Get all tradeable items from shop data
   */
  getTradeableItems(shopData = null) {
    if (!shopData) {
      shopData = this.loadShopData();
    }

    return Object.entries(shopData.items)
      .filter(([itemId, item]) => item.tradeable)
      .map(([itemId, item]) => ({
        itemId,
        ...item,
      }));
  }

  /**
   * Display shop data summary
   */
  displaySummary(shopData = null) {
    if (!shopData) {
      shopData = this.loadShopData();
    }

    console.log(chalk.cyan('\n' + '='.repeat(80)));
    console.log(chalk.cyan.bold('                    SHOP DATA SUMMARY'));
    console.log(chalk.cyan('='.repeat(80)));
    console.log(
      chalk.white(
        `Last Updated: ${new Date(shopData.lastUpdated).toLocaleString()}`
      )
    );
    console.log(
      chalk.white(`Total Shops: ${Object.keys(shopData.shops).length}`)
    );
    console.log(
      chalk.white(`Total Items: ${Object.keys(shopData.items).length}`)
    );

    const tradeableItems = this.getTradeableItems(shopData);
    console.log(chalk.white(`Tradeable Items: ${tradeableItems.length}`));

    // Show some examples
    console.log(chalk.yellow('\nMost Expensive Tradeable Items:'));
    tradeableItems
      .sort((a, b) => b.shops[0].price - a.shops[0].price)
      .slice(0, 5)
      .forEach((item) => {
        const cheapest = item.shops[0];
        console.log(
          chalk.white(
            `  ${item.name}: $${cheapest.price.toLocaleString()} (${
              cheapest.shopName
            })`
          )
        );
      });
  }
}

// Run if called directly
if (require.main === module) {
  const manager = new ShopDataManager();

  manager.init();
  manager
    .saveShopData()
    .then((data) => {
      manager.displaySummary(data);
    })
    .catch((error) => {
      console.error(chalk.red(`❌ Error: ${error.message}`));
    });
}

module.exports = ShopDataManager;
