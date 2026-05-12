// Types for Inventory Timeline & Multi-Supplier Order Manager

export interface ProductSnapshot {
  clave: string;
  descripcion: string;
  existencia: number;
  precioC: number;
  precioV?: number;
  proveedor: string;
  stockObjetivo?: number;
  piezas?: number;
  // Smart-inventory fields (populated from current_inventory store)
  lastUpdatedDate?: Date;
  firstSeenDate?: Date;
  historyCount?: number;
}

export interface InventorySnapshot {
  id: string;
  date: Date;
  timestamp: number;
  products: ProductSnapshot[];
  fileName: string;
  supplierName?: string;
  fileHash?: string; // Hash to detect duplicate imports
}

export interface ProductHistory {
  clave: string;
  descripcion: string;
  proveedor: string;
  snapshots: {
    snapshotId: string;
    date: Date;
    existencia: number;
  }[];
}

export interface ProductVelocity {
  clave: string;
  descripcion: string;
  weeklyVelocity: number; // Units sold per week
  isSlowMover: boolean;
  stockTrend: 'increasing' | 'decreasing' | 'stable';
  last5Snapshots: {
    date: Date;
    existencia: number;
  }[];
}

export interface SupplierGroup {
  supplierName: string;
  products: ProductWithOrder[];
  totalInvestment: number;
  totalItems: number;
}

export interface ProductWithOrder extends ProductSnapshot {
  needed: number;
  suggestedOrder: number;
  orderValue: number;
  stockStatus: 'out' | 'low' | 'healthy';
  stockPercentage: number; // Current stock vs target percentage
}

export interface OrderSheet {
  supplierName: string;
  date: Date;
  items: {
    clave: string;
    descripcion: string;
    currentStock: number;
    targetStock: number;
    needed: number;
    piezas: number;
    suggestedOrder: number;
    unitPrice: number;
    totalPrice: number;
  }[];
  totalInvestment: number;
}

// Database types for IndexedDB
export interface SnapshotDB {
  id: string;
  timestamp: number;
  date: string;
  fileName: string;
  supplierName?: string;
  productCount: number;
}

export interface ProductDataDB {
  snapshotId: string;
  clave: string;
  descripcion: string;
  existencia: number;
  precioC: number;
  precioV?: number;
  proveedor: string;
  stockObjetivo?: number;
  piezas?: number;
}
