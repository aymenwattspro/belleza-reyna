// IndexedDB service for Orders & Order History

const DB_NAME = 'BellezaReynaOrdersDB';
const DB_VERSION = 1;

export interface OrderItem {
  id?: number;
  orderId: string;
  clave: string;
  descripcion: string;
  proveedor: string;
  currentStock: number;
  unitsToOrder: number;
  unitCost: number;
  lineTotal: number;
}

export interface ConfirmedOrder {
  id: string;
  confirmedAt: string;
  supplierName: string;
  totalProducts: number;
  totalValue: number;
  items: OrderItem[];
}

export interface DeselectedProduct {
  clave: string;
  deselectedAt: string;
}

class OrdersDBService {
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

        // Confirmed orders store
        if (!db.objectStoreNames.contains('confirmedOrders')) {
          const orderStore = db.createObjectStore('confirmedOrders', { keyPath: 'id' });
          orderStore.createIndex('confirmedAt', 'confirmedAt', { unique: false });
        }

        // Order items store
        if (!db.objectStoreNames.contains('orderItems')) {
          const itemStore = db.createObjectStore('orderItems', {
            keyPath: 'id',
            autoIncrement: true,
          });
          itemStore.createIndex('orderId', 'orderId', { unique: false });
        }

        // Deselected products (persist between sessions)
        if (!db.objectStoreNames.contains('deselectedProducts')) {
          db.createObjectStore('deselectedProducts', { keyPath: 'clave' });
        }
      };
    });
  }

  // ─── Confirmed Orders ──────────────────────────────────────────────────────

  async saveConfirmedOrder(order: ConfirmedOrder): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction(['confirmedOrders', 'orderItems'], 'readwrite');

    // Save order metadata
    await new Promise<void>((res, rej) => {
      const r = tx.objectStore('confirmedOrders').put({
        id: order.id,
        confirmedAt: order.confirmedAt,
        supplierName: order.supplierName,
        totalProducts: order.totalProducts,
        totalValue: order.totalValue,
      });
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });

    // Save each line item
    for (const item of order.items) {
      await new Promise<void>((res, rej) => {
        const r = tx.objectStore('orderItems').add({ ...item, orderId: order.id });
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    }
  }

  async getConfirmedOrders(): Promise<ConfirmedOrder[]> {
    if (!this.db) await this.init();

    const orders = await new Promise<any[]>((res, rej) => {
      const r = this.db!.transaction('confirmedOrders', 'readonly')
        .objectStore('confirmedOrders')
        .getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });

    // Sort descending
    orders.sort(
      (a, b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime()
    );

    // Load items for each order
    const result: ConfirmedOrder[] = [];
    for (const order of orders) {
      const items = await this.getOrderItems(order.id);
      result.push({ ...order, items });
    }
    return result;
  }

  async getOrderItems(orderId: string): Promise<OrderItem[]> {
    if (!this.db) await this.init();

    return new Promise((res, rej) => {
      const tx = this.db!.transaction('orderItems', 'readonly');
      const idx = tx.objectStore('orderItems').index('orderId');
      const r = idx.getAll(orderId);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  async deleteConfirmedOrder(orderId: string): Promise<void> {
    if (!this.db) await this.init();

    const tx = this.db!.transaction(['confirmedOrders', 'orderItems'], 'readwrite');

    await new Promise<void>((res, rej) => {
      const r = tx.objectStore('confirmedOrders').delete(orderId);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });

    // Delete associated items
    const keys = await new Promise<IDBValidKey[]>((res, rej) => {
      const idx = tx.objectStore('orderItems').index('orderId');
      const r = idx.getAllKeys(orderId);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });

    for (const key of keys) {
      await new Promise<void>((res, rej) => {
        const r = tx.objectStore('orderItems').delete(key);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    }
  }

  // ─── Deselected Products ───────────────────────────────────────────────────

  async getDeselectedClaves(): Promise<string[]> {
    if (!this.db) await this.init();

    return new Promise((res, rej) => {
      const r = this.db!.transaction('deselectedProducts', 'readonly')
        .objectStore('deselectedProducts')
        .getAllKeys();
      r.onsuccess = () => res(r.result as string[]);
      r.onerror = () => rej(r.error);
    });
  }

  async deselect(clave: string): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((res, rej) => {
      const r = this.db!
        .transaction('deselectedProducts', 'readwrite')
        .objectStore('deselectedProducts')
        .put({ clave, deselectedAt: new Date().toISOString() });
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  async reselect(clave: string): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((res, rej) => {
      const r = this.db!
        .transaction('deselectedProducts', 'readwrite')
        .objectStore('deselectedProducts')
        .delete(clave);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  async clearDeselected(): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((res, rej) => {
      const r = this.db!
        .transaction('deselectedProducts', 'readwrite')
        .objectStore('deselectedProducts')
        .clear();
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }
}

export const ordersDB = new OrdersDBService();
