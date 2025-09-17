// API Types
export interface TornAPIError {
  code: number;
  error: string;
}

export interface TornAPIResponse {
  error?: TornAPIError;
  [key: string]: any;
}

export interface TornUser {
  player_id: number;
  name: string;
  level: number;
  honor: number;
  gender: string;
  property: string;
  signup: string;
  awards: number;
  friends: number;
  enemies: number;
  forum_posts: number;
  karma: number;
  age: number;
  role: string;
  donator: number;
  property_id: number;
  competition?: any;
  status?: any;
  job?: any;
  faction?: any;
  married?: any;
  basicicons?: any;
  life?: any;
  last_action?: any;
}

export interface TornItem {
  name: string;
  description: string;
  type: string;
  weapon_type?: string;
  buy_price: number;
  sell_price: number;
  market_value: number;
  circulation: number;
  image: string;
  tradeable: boolean;
  recyclable: boolean;
}

export interface TornShop {
  name: string;
  inventory?: {
    [itemId: string]: {
      name: string;
      price: number;
      in_stock: number;
    };
  };
}

export interface TornExchangeListing {
  id: string;
  item_id: string;
  item: string;
  price: number;
  quantity: number;
  trader: string;
  date_listed: string;
}

export interface TornExchangeResponse {
  status: string;
  message?: string;
  rate_limited?: boolean;
  retry_after?: number;
  data?: {
    listings: TornExchangeListing[];
    meta?: {
      total_listings: number;
      current_page: number;
      total_pages: number;
    };
  };
}

// App Types
export interface UseCase {
  id: string;
  title: string;
  description: string;
  icon: string;
  status: 'ready' | 'beta' | 'coming-soon';
  route: string;
  disabled?: boolean;
}

export interface ProfitAnalysisItem {
  itemId: string;
  name: string;
  shopPrice: number;
  shopName: string;
  bazaarPrice: number | null;
  bazaarTrader?: string;
  totalListings?: number;
  profit: number | null;
  profitMargin: number | null;
  profitPer100: number | null;
  maxStock: number;
  maxBuy?: number;
  status: 'Profitable' | 'Loss' | 'No Bazaar Data' | string;
}

export interface ProfitAnalysisResult {
  timestamp: string;
  totalItems: number;
  profitable: number;
  results: ProfitAnalysisItem[];
}

export interface ShopDataItem {
  name: string;
  type: string;
  tradeable: boolean;
  shops: Array<{
    shopId: string;
    shopName: string;
    price: number;
    stock: number;
  }>;
}

export interface ShopData {
  lastUpdated: string;
  shops: {
    [shopId: string]: TornShop;
  };
  items: {
    [itemId: string]: ShopDataItem;
  };
}

// Storage Types
export interface StoredApiKey {
  key: string;
  timestamp: number;
  userInfo?: {
    name: string;
    playerId: number;
  };
}

// Utility Types
export type APIKeyValidationResult = {
  valid: boolean;
  user?: TornUser;
  error?: string;
};

// Rental Types
export interface TornProperty {
  name: string;
  cost: number;
  happiness: number;
  upkeep: number;
  staff_cost: number;
  size: number;
  property_type: number;
  marketprice: number;
}

export interface RentalData {
  // API response fields
  happy: number;
  cost: number;
  cost_per_day: number;
  rental_period: number;
  market_price: number;
  upkeep: number;
  modifications: string[];
  property: {
    id: number;
    name: string;
  };
}

export interface RentalFilters {
  propertyType: string;
  minHappiness: number;
  maxCostPerDay: number;
  minRentalPeriod: number;
  maxRentalPeriod: number;
}

export interface RentalSortOption {
  field: 'happy' | 'cost_per_day' | 'rental_period' | 'property_name';
  direction: 'asc' | 'desc';
}
