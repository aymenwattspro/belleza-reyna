// Ordering Engine for Smart Order Calculation
import { ProductSnapshot, ProductWithOrder, SupplierGroup, OrderSheet } from '@/lib/types/inventory-timeline';

/**
 * Calculate stock status based on current vs target
 */
function calculateStockStatus(
  existencia: number,
  stockObjetivo: number = 0
): { status: 'out' | 'low' | 'healthy'; percentage: number } {
  if (stockObjetivo === 0) {
    return { status: existencia === 0 ? 'out' : 'healthy', percentage: 100 };
  }

  const percentage = (existencia / stockObjetivo) * 100;

  if (existencia === 0) {
    return { status: 'out', percentage: 0 };
  } else if (percentage < 50) {
    return { status: 'low', percentage };
  } else {
    return { status: 'healthy', percentage };
  }
}

/**
 * Calculate suggested order quantity
 * Formula: Needed = (Stock_Objetivo - Current_Stock)
 * If Needed > 0: Suggested_Order = Math.ceil(Needed / Piezas) * Piezas
 */
export function calculateOrder(product: ProductSnapshot): ProductWithOrder {
  const stockObjetivo = product.stockObjetivo || 0;
  const piezas = product.piezas || 1;
  const existencia = product.existencia || 0;

  // Calculate needed quantity
  const needed = Math.max(0, stockObjetivo - existencia);

  // Calculate suggested order (round up to nearest multiple of piezas)
  let suggestedOrder = 0;
  if (needed > 0 && piezas > 0) {
    suggestedOrder = Math.ceil(needed / piezas) * piezas;
  }

  // Calculate order value
  const orderValue = suggestedOrder * (product.precioC || 0);

  // Calculate stock status
  const { status, percentage } = calculateStockStatus(existencia, stockObjetivo);

  return {
    ...product,
    needed,
    suggestedOrder,
    orderValue,
    stockStatus: status,
    stockPercentage: percentage
  };
}

/**
 * Process all products and calculate orders
 */
export function processOrders(inventory: ProductSnapshot[]): ProductWithOrder[] {
  return inventory.map(calculateOrder);
}

/**
 * Group products by supplier
 */
export function groupBySupplier(products: ProductWithOrder[]): SupplierGroup[] {
  const groups = new Map<string, ProductWithOrder[]>();

  products.forEach(product => {
    const supplier = product.proveedor || 'General';
    if (!groups.has(supplier)) {
      groups.set(supplier, []);
    }
    groups.get(supplier)!.push(product);
  });

  return Array.from(groups.entries())
    .map(([supplierName, products]) => ({
      supplierName,
      products: products.sort((a, b) => b.orderValue - a.orderValue),
      totalInvestment: products.reduce((sum, p) => sum + p.orderValue, 0),
      totalItems: products.filter(p => p.suggestedOrder > 0).length
    }))
    .sort((a, b) => b.totalInvestment - a.totalInvestment);
}

/**
 * Generate order sheet for export
 */
export function generateOrderSheet(
  supplierName: string,
  products: ProductWithOrder[]
): OrderSheet {
  const items = products
    .filter(p => p.suggestedOrder > 0)
    .map(p => ({
      clave: p.clave,
      descripcion: p.descripcion,
      currentStock: p.existencia,
      targetStock: p.stockObjetivo || 0,
      needed: p.needed,
      piezas: p.piezas || 1,
      suggestedOrder: p.suggestedOrder,
      unitPrice: p.precioC,
      totalPrice: p.orderValue
    }));

  return {
    supplierName,
    date: new Date(),
    items,
    totalInvestment: items.reduce((sum, item) => sum + item.totalPrice, 0)
  };
}

/**
 * Export order sheet to CSV
 */
export function exportOrderSheetToCSV(orderSheet: OrderSheet): string {
  const headers = [
    'Clave',
    'Descripcion',
    'Stock Actual',
    'Stock Objetivo',
    'Necesidad',
    'Piezas',
    'Pedido Sugerido',
    'Precio Unit',
    'Total'
  ];

  const rows = orderSheet.items.map(item => [
    item.clave,
    `"${item.descripcion.replace(/"/g, '""')}"`, // Escape quotes
    item.currentStock,
    item.targetStock,
    item.needed,
    item.piezas,
    item.suggestedOrder,
    item.unitPrice.toFixed(2),
    item.totalPrice.toFixed(2)
  ]);

  const csvContent = [
    `Pedido para: ${orderSheet.supplierName}`,
    `Fecha: ${orderSheet.date.toLocaleDateString('es-MX')}`,
    '',
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  return csvContent;
}

/**
 * Export order sheet to XLSX
 */
export function exportOrderSheetToXLSX(orderSheet: OrderSheet): ArrayBuffer {
  const { utils, write } = require('xlsx');

  const headers = [
    'Clave',
    'Descripcion',
    'Stock Actual',
    'Stock Objetivo',
    'Necesidad',
    'Piezas',
    'Pedido Sugerido',
    'Precio Unit',
    'Total'
  ];

  const data = [
    [`Pedido para: ${orderSheet.supplierName}`],
    [`Fecha: ${orderSheet.date.toLocaleDateString('es-MX')}`],
    [],
    headers,
    ...orderSheet.items.map(item => [
      item.clave,
      item.descripcion,
      item.currentStock,
      item.targetStock,
      item.needed,
      item.piezas,
      item.suggestedOrder,
      item.unitPrice,
      item.totalPrice
    ]),
    [],
    ['', '', '', '', '', '', '', 'TOTAL:', orderSheet.totalInvestment]
  ];

  const ws = utils.aoa_to_sheet(data);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'Pedido');

  return write(wb, { type: 'array' });
}

/**
 * Get color coding for stock status
 */
export function getStockStatusColor(status: 'out' | 'low' | 'healthy'): string {
  switch (status) {
    case 'out':
      return 'bg-red-500';
    case 'low':
      return 'bg-yellow-500';
    case 'healthy':
      return 'bg-green-500';
    default:
      return 'bg-gray-500';
  }
}

/**
 * Get stock status label
 */
export function getStockStatusLabel(status: 'out' | 'low' | 'healthy'): string {
  switch (status) {
    case 'out':
      return 'Sin Stock';
    case 'low':
      return 'Stock Bajo';
    case 'healthy':
      return 'Stock OK';
    default:
      return 'Desconocido';
  }
}
