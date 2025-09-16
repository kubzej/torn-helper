const ShopDataManager = require('./shopDataManager');
const TornExchangeAPI = require('./tornExchangeAPI');
const chalk = require('chalk');
const fs = require('fs');

class ProfitAnalyzer {
  constructor() {
    this.shopManager = new ShopDataManager();
    this.teAPI = new TornExchangeAPI();
    this.results = [];
  }

  /**
   * Format currency values
   */
  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
      .format(amount)
      .replace('$', '$');
  }

  /**
   * Format percentage values
   */
  formatPercentage(value) {
    return `${value.toFixed(1)}%`;
  }

  /**
   * Analyze profit for a single item
   */
  async analyzeItem(itemId, itemData) {
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

  /**
   * Analyze all tradeable items
   */
  async analyzeAllItems() {
    console.log(chalk.magenta.bold('\n💰 TORN PROFIT ANALYZER'));
    console.log(
      chalk.gray('Comparing city shop prices with TornExchange bazaar prices\n')
    );

    // Check TornExchange API status
    console.log(chalk.blue('🔌 Checking TornExchange API status...'));
    const status = await this.teAPI.getStatus();
    if (!status) {
      throw new Error('TornExchange API is not available');
    }
    console.log(chalk.green('✅ TornExchange API is working'));

    // Load shop data
    let shopData;
    try {
      shopData = this.shopManager.loadShopData();
      console.log(chalk.green('✅ Shop data loaded'));
    } catch (error) {
      console.log(
        chalk.yellow('⚠️  Shop data not found, fetching fresh data...')
      );
      this.shopManager.init();
      shopData = await this.shopManager.saveShopData();
    }

    const tradeableItems = this.shopManager.getTradeableItems(shopData);
    console.log(
      chalk.blue(`🔄 Found ${tradeableItems.length} tradeable items`)
    );

    // Analyze all items
    const itemsToAnalyze = tradeableItems;
    console.log(chalk.blue(`📊 Analyzing all ${itemsToAnalyze.length} items`));

    this.results = [];

    for (let i = 0; i < itemsToAnalyze.length; i++) {
      const item = itemsToAnalyze[i];
      process.stdout.write(
        `\r${chalk.blue('⏳')} Analyzing item ${i + 1}/${
          itemsToAnalyze.length
        }: ${item.name.substring(0, 30)}...`
      );

      try {
        const result = await this.analyzeItem(item.itemId, item);
        this.results.push(result);
      } catch (error) {
        console.error(
          `\nError analyzing item ${item.itemId}: ${error.message}`
        );
        // Add error entry
        this.results.push({
          itemId: item.itemId,
          name: item.name,
          shopPrice: item.shops[0].price,
          shopName: item.shops[0].shopName,
          status: 'Error: ' + error.message,
        });
      }
    }

    console.log(chalk.green('\n✅ Analysis complete!'));
    return this.results;
  }

  /**
   * Display results in a formatted table
   */
  displayResults() {
    if (this.results.length === 0) {
      console.log(chalk.yellow('No results to display'));
      return;
    }

    // Sort by profit margin (descending)
    const sortedResults = [...this.results].sort((a, b) => {
      if (a.profitMargin === null) return 1;
      if (b.profitMargin === null) return -1;
      return b.profitMargin - a.profitMargin;
    });

    console.log(chalk.cyan('\n' + '='.repeat(130)));
    console.log(
      chalk.cyan.bold(
        '                                   PROFIT ANALYSIS RESULTS'
      )
    );
    console.log(chalk.cyan('='.repeat(130)));

    // Table header
    console.log(
      chalk.white.bold(
        'Item Name'.padEnd(25) +
          'Shop Price'.padEnd(12) +
          'Max Bazaar'.padEnd(13) +
          'Profit/Item'.padEnd(12) +
          'Margin'.padEnd(8) +
          'Profit/100'.padEnd(12) +
          'Stock'.padEnd(8) +
          'Status'.padEnd(15) +
          'Shop'
      )
    );
    console.log(chalk.gray('-'.repeat(130)));

    // Display all items
    const itemsToShow = sortedResults;

    itemsToShow.forEach((item, index) => {
      const rank = `${index + 1}.`.padEnd(3);
      const name = item.name.substring(0, 22).padEnd(25);
      const shopPrice = this.formatCurrency(item.shopPrice).padEnd(12);
      const bazaarPrice = item.bazaarPrice
        ? this.formatCurrency(item.bazaarPrice).padEnd(13)
        : 'N/A'.padEnd(13);
      const profit =
        item.profit !== null
          ? this.formatCurrency(item.profit).padEnd(12)
          : 'N/A'.padEnd(12);
      const margin =
        item.profitMargin !== null
          ? this.formatPercentage(item.profitMargin).padEnd(8)
          : 'N/A'.padEnd(8);
      const profitPer100 =
        item.profitPer100 !== null
          ? this.formatCurrency(item.profitPer100).padEnd(12)
          : 'N/A'.padEnd(12);
      const stock = item.maxStock.toString().padEnd(8);
      const status = item.status.padEnd(15);
      const shop = item.shopName.substring(0, 15);

      // Color coding
      let lineColor = chalk.white;
      if (item.status === 'Profitable') {
        if (item.profitMargin >= 50) lineColor = chalk.green;
        else if (item.profitMargin >= 20) lineColor = chalk.yellow;
      } else if (item.status === 'Loss') {
        lineColor = chalk.red;
      } else {
        lineColor = chalk.gray;
      }

      console.log(
        lineColor(
          rank +
            name +
            shopPrice +
            bazaarPrice +
            profit +
            margin +
            profitPer100 +
            stock +
            status +
            shop
        )
      );
    });

    // Summary
    const profitable = this.results.filter((r) => r.status === 'Profitable');
    const avgMargin =
      profitable.length > 0
        ? profitable.reduce((sum, r) => sum + r.profitMargin, 0) /
          profitable.length
        : 0;
    const totalPotential = profitable.reduce(
      (sum, r) => sum + (r.profitPer100 || 0),
      0
    );

    console.log(chalk.cyan('\n' + '='.repeat(130)));
    console.log(
      chalk.white(
        `📊 Summary: ${profitable.length}/${this.results.length} profitable items`
      )
    );
    console.log(
      chalk.white(
        `📈 Average profit margin: ${this.formatPercentage(avgMargin)}`
      )
    );
    console.log(
      chalk.white(
        `💰 Total potential profit (100 each): ${this.formatCurrency(
          totalPotential
        )}`
      )
    );
  }

  /**
   * Save results to JSON file
   */
  saveResults(filename = 'profit-analysis.json') {
    const data = {
      timestamp: new Date().toISOString(),
      totalItems: this.results.length,
      profitable: this.results.filter((r) => r.status === 'Profitable').length,
      results: this.results,
    };

    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    console.log(chalk.green(`💾 Results saved to ${filename}`));
  }
}

// Run if called directly
if (require.main === module) {
  const analyzer = new ProfitAnalyzer();

  analyzer
    .analyzeAllItems() // Analyze all items
    .then(() => {
      analyzer.displayResults();
      analyzer.saveResults();
    })
    .catch((error) => {
      console.error(chalk.red(`❌ Error: ${error.message}`));
    });
}

module.exports = ProfitAnalyzer;
