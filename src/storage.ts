import { StoredApiKey, TornUser } from '@/types';

export class StorageManager {
  private static readonly API_KEY_STORAGE_KEY = 'torn_helper_api_key';
  private static readonly CACHE_PREFIX = 'torn_helper_cache_';

  /**
   * Store API key with user information
   */
  setApiKey(apiKey: string, user: TornUser): void {
    const data: StoredApiKey = {
      key: apiKey,
      timestamp: Date.now(),
      userInfo: {
        name: user.name,
        playerId: user.player_id,
      },
    };

    localStorage.setItem(
      StorageManager.API_KEY_STORAGE_KEY,
      JSON.stringify(data)
    );
  }

  /**
   * Get stored API key
   */
  getApiKey(): StoredApiKey | null {
    try {
      const stored = localStorage.getItem(StorageManager.API_KEY_STORAGE_KEY);
      if (!stored) return null;

      const data: StoredApiKey = JSON.parse(stored);

      // Check if key is older than 7 days (optional expiration)
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - data.timestamp > sevenDays) {
        this.removeApiKey();
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error reading stored API key:', error);
      this.removeApiKey();
      return null;
    }
  }

  /**
   * Remove stored API key
   */
  removeApiKey(): void {
    localStorage.removeItem(StorageManager.API_KEY_STORAGE_KEY);
  }

  /**
   * Cache data with expiration
   */
  setCache<T>(key: string, data: T, expirationMs: number = 300000): void {
    // 5 minutes default
    const cacheData = {
      data,
      timestamp: Date.now(),
      expiration: expirationMs,
    };

    localStorage.setItem(
      `${StorageManager.CACHE_PREFIX}${key}`,
      JSON.stringify(cacheData)
    );
  }

  /**
   * Get cached data if not expired
   */
  getCache<T>(key: string): T | null {
    try {
      const stored = localStorage.getItem(
        `${StorageManager.CACHE_PREFIX}${key}`
      );
      if (!stored) return null;

      const cacheData = JSON.parse(stored);
      const isExpired = Date.now() - cacheData.timestamp > cacheData.expiration;

      if (isExpired) {
        this.removeCache(key);
        return null;
      }

      return cacheData.data as T;
    } catch (error) {
      console.error('Error reading cache:', error);
      this.removeCache(key);
      return null;
    }
  }

  /**
   * Remove cached data
   */
  removeCache(key: string): void {
    localStorage.removeItem(`${StorageManager.CACHE_PREFIX}${key}`);
  }

  /**
   * Clear all cached data
   */
  clearAllCache(): void {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith(StorageManager.CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  }

  /**
   * Get storage usage info
   */
  getStorageInfo(): { used: number; total: number; percentage: number } {
    let used = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        used += localStorage[key].length + key.length;
      }
    }

    // Approximate localStorage limit (usually 5-10MB)
    const total = 5 * 1024 * 1024; // 5MB
    const percentage = (used / total) * 100;

    return { used, total, percentage };
  }
}
