# Torn Market Profit Watcher

A simple JavaScript tool to analyze the Torn game market and find profitable trading opportunities between city shops and bazaars using real-time data from TornExchange.

## Features

- Fetches and saves current city shop prices
- Gets real-time bazaar prices from TornExchange API (highest available price)
- Calculates profit margins per item and per 100 items
- Displays profitable trading opportunities with color-coded output
- Respects API rate limits for both Torn and TornExchange

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file and add your Torn API key:

   ```
   TORN_API_KEY=your_api_key_here
   ```

3. Get your API key from: https://www.torn.com/preferences.php#tab=api

**Note**: The script will automatically generate `shop-data.json` and `profit-analysis.json` files when you run it.

## Usage

### Save Shop Data (First Time)

```bash
npm run save-shops
```

This fetches current city shop prices and saves them to `shop-data.json`.

### Analyze Profits

```bash
npm start
# or
npm run analyze
```

This compares shop prices with TornExchange bazaar prices and shows profit opportunities, ordered by profit (highest first).

## How It Works

1. **Shop Data**: Fetches current city shop prices from Torn API (saved locally in `shop-data.json`)
2. **Bazaar Prices**: Gets real-time highest bazaar prices from TornExchange API
3. **Profit Analysis**: Calculates profit margins and displays results in a color-coded table

## Output

The tool displays a table with:

- Item name and shop price
- Highest available bazaar price
- Profit per item and per 100 items
- Profit margin percentage
- Available stock
- Shop name

Results are automatically sorted by profit (highest profit first).

## Rate Limits

- **Torn API**: 100 requests per minute (automatically handled)
- **TornExchange API**: 10 requests per minute (6-second delays between requests)

## Requirements

- Node.js 14 or higher
- Valid Torn API key
- Internet connection

## License

MIT
