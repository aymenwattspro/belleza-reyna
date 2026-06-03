// ─────────────────────────────────────────────────────────────────────────────
// Permanent Supplier Database  ·  IndexedDB service
//
// Stores suppliers permanently so they can be created once and reused across
// every order/import. Supports full CRUD (create / read / update / delete).
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'BellezaReynaSuppliersDB';
const DB_VERSION = 1;

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

class SuppliersDBService {
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
        if (!db.objectStoreNames.contains('suppliers')) {
          const store = db.createObjectStore('suppliers', { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
        }
      };
    });
  }

  async getAll(): Promise<Supplier[]> {
    if (!this.db) await this.init();
    return new Promise((res, rej) => {
      const r = this.db!
        .transaction('suppliers', 'readonly')
        .objectStore('suppliers')
        .getAll();
      r.onsuccess = () => {
        const list = (r.result as Supplier[]).sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        res(list);
      };
      r.onerror = () => rej(r.error);
    });
  }

  async get(id: string): Promise<Supplier | null> {
    if (!this.db) await this.init();
    return new Promise((res, rej) => {
      const r = this.db!
        .transaction('suppliers', 'readonly')
        .objectStore('suppliers')
        .get(id);
      r.onsuccess = () => res((r.result as Supplier) || null);
      r.onerror = () => rej(r.error);
    });
  }

  async save(supplier: Supplier): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((res, rej) => {
      const r = this.db!
        .transaction('suppliers', 'readwrite')
        .objectStore('suppliers')
        .put(supplier);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  async delete(id: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((res, rej) => {
      const r = this.db!
        .transaction('suppliers', 'readwrite')
        .objectStore('suppliers')
        .delete(id);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }
}

export const suppliersDB = new SuppliersDBService();
