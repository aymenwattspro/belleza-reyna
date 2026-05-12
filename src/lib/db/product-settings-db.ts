// IndexedDB service for per-product settings (min stock, etc.)

const DB_NAME = 'BellezaReynaSettingsDB';
const DB_VERSION = 1;

export interface ProductSettings {
  clave: string;
  minStockUnits: number;       // Minimum stock in units
  minStockCases: number;       // Minimum stock in cases/lots
  unitsPerCaseOverride?: number; // Override piezas from import
  notes?: string;
  updatedAt: string;
}

class ProductSettingsDBService {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('productSettings')) {
          db.createObjectStore('productSettings', { keyPath: 'clave' });
        }
      };
    });
  }

  async get(clave: string): Promise<ProductSettings | null> {
    if (!this.db) await this.init();
    return new Promise((res, rej) => {
      const r = this.db!
        .transaction('productSettings', 'readonly')
        .objectStore('productSettings')
        .get(clave);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  }

  async save(settings: ProductSettings): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((res, rej) => {
      const r = this.db!
        .transaction('productSettings', 'readwrite')
        .objectStore('productSettings')
        .put({ ...settings, updatedAt: new Date().toISOString() });
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  async getAll(): Promise<ProductSettings[]> {
    if (!this.db) await this.init();
    return new Promise((res, rej) => {
      const r = this.db!
        .transaction('productSettings', 'readonly')
        .objectStore('productSettings')
        .getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  async delete(clave: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((res, rej) => {
      const r = this.db!
        .transaction('productSettings', 'readwrite')
        .objectStore('productSettings')
        .delete(clave);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }
}

export const productSettingsDB = new ProductSettingsDBService();
