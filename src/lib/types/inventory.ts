export interface RawInventoryItem {
  [key: string]: any;
}

export interface InventoryItem {
  clave: string;
  descripcion: string;
  precioC: number;
  precioV?: number; // Sale price (Precio V. from CSV)
  existencia: number;
  proveedor?: string; // Supplier name (extracted from Departamento column)
  supplierId?: string; // ID of the supplier (extracted from Proveedor column)
  stockObjetivo?: number;
  piezas?: number; // Package multiple
  pedido?: number;
  valorPedido?: number;
}

export interface PurchaseOrderSummary {
  totalProducts: number;
  productsToOrder: number;
  totalValue: number;
  supplierName: string;
  minOrderValue: number;
  date: string;
}

export interface HistoryItem {
  id: string;
  date: string;
  supplier: string;
  totalValue: number;
  itemsCount: number;
  items: InventoryItem[];
}

export interface Supplier {
  id: string;
  name: string;
  minOrder: number;
}
