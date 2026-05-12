// ─────────────────────────────────────────────────────────────────────────────
// Smart Inventory DB  ·  v3
//
// Stores
//   legacy  : snapshots | products          (kept for migration)
//   new     : imports | current_inventory | stock_history
//
// Smart-merge rule
//   • stock changed  → insert stock_history entry + update current_inventory
//   • stock same     → update metadata only; lastUpdatedDate stays unchanged
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'InventoryTimelineDB';
const DB_VERSION = 3;

const MIGRATION_KEY = 'inv_v3_migrated';

// ── Helper types ──────────────────────────────────────────────────────────────

export interface ImportMeta {
  id: string;
  timestamp: number;
  date: string;
  fileName: string;
  supplierName?: string;
  fileHash?: string;
  productCount: number;
}

export interface CurrentInventoryItem {
  clave: string;
  descripcion: string;
  proveedor: string;
  existencia: number;
  precioC: number;
  precioV?: number;
  stockObjetivo?: number;
  piezas?: number;
  firstSeenDate: string;   // ISO string of first import
  lastUpdatedDate: string; // ISO string of last STOCK CHANGE
  historyCount: number;    // number of stock_history entries
}

export interface StockHistoryEntry {
  id?: number;              // auto-incremented PK
  clave: string;
  descripcion: string;
  proveedor: string;
  existencia: number;
  precioC: number;
  precioV?: number;
  stockObjetivo?: number;
  piezas?: number;
  importDate: string;       // ISO string
  importTimestamp: number;
  importId: string;
}

export interface SmartSaveResult {
  newProducts: number;
  updatedProducts: number;
  unchangedProducts: number;
}

// ── DB Service ────────────────────────────────────────────────────────────────

class InventoryDBService {
  private db: IDBDatabase | null = null;

  // ── Open / upgrade ───────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => { this.db = request.result; resolve(); };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const old = event.oldVersion;

        // ─── legacy (v1→v2) ───
        if (old < 2 && db.objectStoreNames.contains('products')) {
          db.deleteObjectStore('products');
        }
        if (!db.objectStoreNames.contains('snapshots')) {
          const s = db.createObjectStore('snapshots', { keyPath: 'id' });
          s.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains('products')) {
          const s = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
          s.createIndex('snapshotId', 'snapshotId', { unique: false });
          s.createIndex('clave', 'clave', { unique: false });
        }

        // ─── v3 smart stores ───
        if (old < 3) {
          if (!db.objectStoreNames.contains('imports')) {
            const s = db.createObjectStore('imports', { keyPath: 'id' });
            s.createIndex('timestamp', 'timestamp', { unique: false });
          }
          if (!db.objectStoreNames.contains('current_inventory')) {
            db.createObjectStore('current_inventory', { keyPath: 'clave' });
          }
          if (!db.objectStoreNames.contains('stock_history')) {
            const s = db.createObjectStore('stock_history', { keyPath: 'id', autoIncrement: true });
            s.createIndex('clave', 'clave', { unique: false });
            s.createIndex('importTimestamp', 'importTimestamp', { unique: false });
            s.createIndex('importId', 'importId', { unique: false });
          }
        }
      };
    });
  }

  // ── One-time migration: old snapshots → new stores ────────────────────────

  async migrateToV3IfNeeded(): Promise<void> {
    if (!this.db) await this.init();
    if (typeof localStorage !== 'undefined' && localStorage.getItem(MIGRATION_KEY)) return;

    const currentCount = await this.storeCount('current_inventory');
    if (currentCount > 0) {
      this.markMigrated();
      return;
    }

    // Walk old snapshots oldest→newest and smart-merge into new stores
    const oldMeta = await this.legacyGetSnapshotsMeta();
    if (oldMeta.length === 0) { this.markMigrated(); return; }

    oldMeta.sort((a, b) => a.timestamp - b.timestamp);

    for (const meta of oldMeta) {
      const data = await this.legacyGetSnapshotById(meta.id);
      if (!data) continue;

      // Save import metadata
      await this.putToStore('imports', {
        id: meta.id,
        timestamp: meta.timestamp,
        date: meta.date,
        fileName: meta.fileName,
        supplierName: meta.supplierName,
        fileHash: meta.fileHash,
        productCount: data.products.length,
      });

      // Smart merge each product
      for (const p of data.products) {
        await this.smartMergeProduct(p, meta.id, meta.date, meta.timestamp);
      }
    }

    this.markMigrated();
  }

  private markMigrated() {
    if (typeof localStorage !== 'undefined') localStorage.setItem(MIGRATION_KEY, '1');
  }

  // ── Core smart-merge ──────────────────────────────────────────────────────

  private async smartMergeProduct(
    product: {
      clave: string; descripcion: string; proveedor: string; existencia: number;
      precioC: number; precioV?: number; stockObjetivo?: number; piezas?: number;
    },
    importId: string,
    importDate: string,
    importTimestamp: number,
  ): Promise<'new' | 'updated' | 'unchanged'> {
    // Always use a trimmed clave as the canonical key
    const clave = String(product.clave ?? '').trim();
    if (clave.length < 2) return 'unchanged';
    product = { ...product, clave };

    const existing = await this.getFromStore('current_inventory', clave) as CurrentInventoryItem | undefined;

    const entry: Omit<StockHistoryEntry, 'id'> = {
      clave: product.clave,
      descripcion: product.descripcion,
      proveedor: product.proveedor || 'General',
      existencia: product.existencia,
      precioC: product.precioC || 0,
      precioV: product.precioV,
      stockObjetivo: product.stockObjetivo,
      piezas: product.piezas,
      importDate,
      importTimestamp,
      importId,
    };

    if (!existing) {
      // ── NEW product ────────────────────────────────────────────────────────
      await this.addToStore('stock_history', entry);
      await this.putToStore('current_inventory', {
        clave: product.clave,
        descripcion: product.descripcion,
        proveedor: product.proveedor || 'General',
        existencia: product.existencia,
        precioC: product.precioC || 0,
        precioV: product.precioV,
        stockObjetivo: product.stockObjetivo,
        piezas: product.piezas,
        firstSeenDate: importDate,
        lastUpdatedDate: importDate,
        historyCount: 1,
      } as CurrentInventoryItem);
      return 'new';
    }

    if (existing.existencia !== product.existencia) {
      // ── STOCK CHANGED ──────────────────────────────────────────────────────
      await this.addToStore('stock_history', entry);
      const updated: CurrentInventoryItem = {
        ...existing,
        descripcion: product.descripcion || existing.descripcion,
        proveedor: product.proveedor || existing.proveedor,
        existencia: product.existencia,
        precioC: product.precioC > 0 ? product.precioC : existing.precioC,
        precioV: product.precioV != null ? product.precioV : existing.precioV,
        stockObjetivo: product.stockObjetivo != null ? product.stockObjetivo : existing.stockObjetivo,
        piezas: product.piezas != null ? product.piezas : existing.piezas,
        lastUpdatedDate: importDate,
        historyCount: (existing.historyCount || 1) + 1,
      };
      await this.putToStore('current_inventory', updated);
      return 'updated';
    }

    // ── STOCK UNCHANGED ────────────────────────────────────────────────────
    // Only update metadata that doesn't affect "last updated" date
    const unchanged: CurrentInventoryItem = {
      ...existing,
      descripcion: product.descripcion || existing.descripcion,
      precioC: product.precioC > 0 ? product.precioC : existing.precioC,
      precioV: product.precioV != null ? product.precioV : existing.precioV,
      stockObjetivo: product.stockObjetivo != null ? product.stockObjetivo : existing.stockObjetivo,
      piezas: product.piezas != null ? product.piezas : existing.piezas,
      // NOTE: lastUpdatedDate, historyCount, proveedor NOT changed
    };
    await this.putToStore('current_inventory', unchanged);
    return 'unchanged';
  }

  // ── Main public API ───────────────────────────────────────────────────────

  async saveSnapshot(snapshot: {
    id: string;
    timestamp: number;
    date: string;
    fileName: string;
    supplierName?: string;
    fileHash?: string;
    products: any[];
  }): Promise<SmartSaveResult> {
    if (!this.db) await this.init();

    // Normalise + deduplicate by clave within the file
    const seenClaves = new Set<string>();
    const uniqueProducts = snapshot.products
      .map(p => ({ ...p, clave: String(p.clave ?? '').trim() }))  // Normalise clave
      .filter(p => {
        if (p.clave.length < 2) return false;          // Skip garbage rows
        if (seenClaves.has(p.clave)) return false;     // Deduplicate
        seenClaves.add(p.clave);
        return true;
      });

    // Save import metadata
    await this.putToStore('imports', {
      id: snapshot.id,
      timestamp: snapshot.timestamp,
      date: snapshot.date,
      fileName: snapshot.fileName,
      supplierName: snapshot.supplierName,
      fileHash: snapshot.fileHash,
      productCount: uniqueProducts.length,
    });

    // Smart-merge each product
    const result: SmartSaveResult = { newProducts: 0, updatedProducts: 0, unchangedProducts: 0 };
    for (const p of uniqueProducts) {
      const outcome = await this.smartMergeProduct(p, snapshot.id, snapshot.date, snapshot.timestamp);
      if (outcome === 'new') result.newProducts++;
      else if (outcome === 'updated') result.updatedProducts++;
      else result.unchangedProducts++;
    }

    // ── Also write to legacy stores (keeps old getSnapshotById working) ─────
    await this.legacySaveSnapshot({ ...snapshot, products: uniqueProducts });

    return result;
  }

  async getImports(): Promise<ImportMeta[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['imports'], 'readonly');
      const req = tx.objectStore('imports').index('timestamp').getAll();
      req.onsuccess = () => resolve((req.result as ImportMeta[]).sort((a, b) => b.timestamp - a.timestamp));
      req.onerror = () => reject(req.error);
    });
  }

  async getCurrentInventory(): Promise<CurrentInventoryItem[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['current_inventory'], 'readonly');
      const req = tx.objectStore('current_inventory').getAll();
      req.onsuccess = () => resolve(req.result as CurrentInventoryItem[]);
      req.onerror = () => reject(req.error);
    });
  }

  async getProductStockHistory(clave: string): Promise<StockHistoryEntry[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['stock_history'], 'readonly');
      const req = tx.objectStore('stock_history').index('clave').getAll(clave);
      req.onsuccess = () => resolve((req.result as StockHistoryEntry[]).sort((a, b) => a.importTimestamp - b.importTimestamp));
      req.onerror = () => reject(req.error);
    });
  }

  async getAllStockHistoryItems(): Promise<StockHistoryEntry[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(['stock_history'], 'readonly');
      const req = tx.objectStore('stock_history').getAll();
      req.onsuccess = () => resolve((req.result as StockHistoryEntry[]).sort((a, b) => a.importTimestamp - b.importTimestamp));
      req.onerror = () => reject(req.error);
    });
  }

  // Returns (clave → history entry count) for behavior filtering
  async getHistoryCountMap(): Promise<Map<string, number>> {
    const allItems = await this.getAllStockHistoryItems();
    const map = new Map<string, number>();
    for (const item of allItems) {
      map.set(item.clave, (map.get(item.clave) || 0) + 1);
    }
    return map;
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    if (!this.db) await this.init();

    // Remove from imports
    await this.deleteFromStore('imports', snapshotId);

    // Collect and remove stock_history entries for this import
    const allHistory = await this.getAllStockHistoryItems();
    const toDelete = allHistory.filter(e => e.importId === snapshotId);
    for (const entry of toDelete) {
      if (entry.id != null) await this.deleteFromStore('stock_history', entry.id);
    }

    // Rebuild current_inventory from remaining stock_history
    await this.rebuildCurrentInventory();

    // Legacy stores cleanup
    await this.legacyDeleteSnapshot(snapshotId);
  }

  private async rebuildCurrentInventory(): Promise<void> {
    // ── Step 1: Preserve user-set stockObjetivo / piezas ─────────────────────
    // "Import Target Stock" only writes to current_inventory (not stock_history),
    // so a plain rebuild from stock_history would silently discard those values.
    const existingItems = await this.getCurrentInventory();
    const preservedTargets = new Map<string, { stockObjetivo?: number; piezas?: number }>();
    for (const item of existingItems) {
      if (item.stockObjetivo != null || item.piezas != null) {
        preservedTargets.set(item.clave, {
          stockObjetivo: item.stockObjetivo,
          piezas: item.piezas,
        });
      }
    }

    // ── Step 2: Clear and rebuild from stock_history ───────────────────────────
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(['current_inventory'], 'readwrite');
      const req = tx.objectStore('current_inventory').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    // Re-process all history entries (ordered oldest→newest)
    const allHistory = await this.getAllStockHistoryItems();
    const inventoryMap = new Map<string, CurrentInventoryItem>();

    for (const entry of allHistory) {
      const existing = inventoryMap.get(entry.clave);
      inventoryMap.set(entry.clave, {
        clave: entry.clave,
        descripcion: entry.descripcion,
        proveedor: entry.proveedor,
        existencia: entry.existencia,
        precioC: entry.precioC,
        precioV: entry.precioV,
        stockObjetivo: entry.stockObjetivo,
        piezas: entry.piezas,
        firstSeenDate: existing?.firstSeenDate ?? entry.importDate,
        lastUpdatedDate: entry.importDate,
        historyCount: (existing?.historyCount ?? 0) + 1,
      });
    }

    // ── Step 3: Re-apply preserved target stock values ─────────────────────────
    // User-imported target stock takes priority over what may be in history entries
    for (const [clave, item] of inventoryMap) {
      const preserved = preservedTargets.get(clave);
      if (preserved) {
        if (preserved.stockObjetivo != null) item.stockObjetivo = preserved.stockObjetivo;
        if (preserved.piezas != null) item.piezas = preserved.piezas;
      }
    }

    for (const item of inventoryMap.values()) {
      await this.putToStore('current_inventory', item);
    }
  }

  async clearAll(): Promise<void> {
    if (!this.db) await this.init();
    const storeNames = ['snapshots', 'products', 'imports', 'current_inventory', 'stock_history'];
    for (const name of storeNames) {
      if (this.db!.objectStoreNames.contains(name)) {
        await new Promise<void>((resolve, reject) => {
          const tx = this.db!.transaction([name], 'readwrite');
          const req = tx.objectStore(name).clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      }
    }
    if (typeof localStorage !== 'undefined') localStorage.removeItem(MIGRATION_KEY);
  }

  // Duplicate file detection — checks both imports and legacy snapshots
  async isFileDuplicate(fileHash: string): Promise<boolean> {
    if (!this.db) await this.init();
    const imports = await this.getImports();
    if (imports.some(i => i.fileHash === fileHash)) return true;
    const legacySnaps = await this.legacyGetSnapshotsMeta();
    return legacySnaps.some(s => s.fileHash === fileHash);
  }

  // ── Legacy compatibility ──────────────────────────────────────────────────

  /** Used by InventoryContext to migrate old data on first load */
  async getSnapshots(): Promise<any[]> {
    if (!this.db) await this.init();
    const imports = await this.getImports();
    if (imports.length > 0) return imports;
    return this.legacyGetSnapshotsMeta();
  }

  async getSnapshotById(snapshotId: string): Promise<{ snapshot: any; products: any[] } | null> {
    return this.legacyGetSnapshotById(snapshotId);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async storeCount(name: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([name], 'readonly');
      const req = tx.objectStore(name).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async putToStore(name: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([name], 'readwrite');
      const req = tx.objectStore(name).put(data);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private async addToStore(name: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([name], 'readwrite');
      const req = tx.objectStore(name).add(data);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private async getFromStore(name: string, key: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([name], 'readonly');
      const req = tx.objectStore(name).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async deleteFromStore(name: string, key: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([name], 'readwrite');
      const req = tx.objectStore(name).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ── Legacy read methods ───────────────────────────────────────────────────

  private async legacyGetSnapshotsMeta(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.db!.objectStoreNames.contains('snapshots')) { resolve([]); return; }
      const tx = this.db!.transaction(['snapshots'], 'readonly');
      const req = tx.objectStore('snapshots').getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => b.timestamp - a.timestamp));
      req.onerror = () => reject(req.error);
    });
  }

  private async legacyGetSnapshotById(snapshotId: string): Promise<{ snapshot: any; products: any[] } | null> {
    if (!this.db) return null;
    if (!this.db.objectStoreNames.contains('snapshots') || !this.db.objectStoreNames.contains('products')) return null;

    const tx = this.db.transaction(['snapshots', 'products'], 'readonly');

    const snapshot = await new Promise<any>((resolve, reject) => {
      const req = tx.objectStore('snapshots').get(snapshotId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!snapshot) return null;

    const products = await new Promise<any[]>((resolve, reject) => {
      const req = tx.objectStore('products').index('snapshotId').getAll(snapshotId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return { snapshot, products };
  }

  private async legacySaveSnapshot(snapshot: any): Promise<void> {
    if (!this.db!.objectStoreNames.contains('snapshots')) return;

    const tx = this.db!.transaction(['snapshots', 'products'], 'readwrite');

    await new Promise<void>((resolve, reject) => {
      const req = tx.objectStore('snapshots').put({
        id: snapshot.id, timestamp: snapshot.timestamp, date: snapshot.date,
        fileName: snapshot.fileName, supplierName: snapshot.supplierName,
        fileHash: snapshot.fileHash, productCount: snapshot.products.length,
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    // Clean existing products for this snapshot
    const existingKeys = await new Promise<any[]>((resolve, reject) => {
      const req = tx.objectStore('products').index('snapshotId').getAllKeys(snapshot.id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const key of existingKeys) {
      await new Promise<void>((resolve, reject) => {
        const req = tx.objectStore('products').delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }

    for (const p of snapshot.products) {
      await new Promise<void>((resolve, reject) => {
        const req = tx.objectStore('products').add({
          snapshotId: snapshot.id, clave: p.clave, descripcion: p.descripcion,
          existencia: p.existencia, precioC: p.precioC, precioV: p.precioV,
          proveedor: p.proveedor, stockObjetivo: p.stockObjetivo, piezas: p.piezas,
        });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  }

  private async legacyDeleteSnapshot(snapshotId: string): Promise<void> {
    if (!this.db!.objectStoreNames.contains('snapshots')) return;

    const tx = this.db!.transaction(['snapshots', 'products'], 'readwrite');

    await new Promise<void>((resolve, reject) => {
      const req = tx.objectStore('snapshots').delete(snapshotId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    const keys = await new Promise<any[]>((resolve, reject) => {
      const req = tx.objectStore('products').index('snapshotId').getAllKeys(snapshotId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const key of keys) {
      await new Promise<void>((resolve, reject) => {
        const req = tx.objectStore('products').delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  }

  // Update target stock / piezas directly (no new import entry created)
  async updateTargetStock(updates: Map<string, { stockObjetivo: number; piezas: number }>): Promise<number> {
    if (!this.db) await this.init();
    let count = 0;
    for (const [clave, { stockObjetivo, piezas }] of updates) {
      const existing = await this.getFromStore('current_inventory', clave) as CurrentInventoryItem | undefined;
      if (!existing) continue;
      await this.putToStore('current_inventory', { ...existing, stockObjetivo, piezas });
      count++;
    }
    return count;
  }

  // Legacy: used by old getProductHistory in context
  async getProductHistory(clave: string): Promise<any[]> {
    return this.getProductStockHistory(clave);
  }
}

export const inventoryDB = new InventoryDBService();
