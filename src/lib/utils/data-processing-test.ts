import { InventoryItem, Supplier } from '../types/inventory';

/**
 * Test version of cleanInventoryData to debug the issue
 */
export const testCleanInventoryData = (rawData: any[], managedSuppliers?: Supplier[]): InventoryItem[] => {
  console.log('=== TEST VERSION ===');
  console.log('Raw data length:', rawData.length);
  console.log('Raw data sample:', rawData.slice(0, 10));
  
  if (!rawData || rawData.length < 1) {
    console.log('No raw data');
    return [];
  }

  const cleanedData: InventoryItem[] = [];

  // Simple approach: try to find any row with potential product data
  for (let i = 0; i < Math.min(rawData.length, 50); i++) {
    const row = rawData[i];
    if (!row || !Array.isArray(row)) {
      console.log('Row', i, 'is not array:', row);
      continue;
    }

    console.log('Row', i, 'content:', row);

    // Look for any non-empty cells that might be product data
    const nonEmptyCells = row.filter(cell => cell !== null && cell !== '' && String(cell).trim() !== '');
    console.log('Row', i, 'non-empty cells:', nonEmptyCells.length);

    if (nonEmptyCells.length >= 2) {
      // Try to create an item with first few cells
      const clave = String(row[0] || '').trim();
      const descripcion = String(row[1] || '').trim();
      const precioC = parseFloat(String(row[2] || '0').replace(/[^0-9.]/g, '')) || 0;
      const existencia = parseFloat(String(row[3] || '0').replace(/[^0-9.]/g, '')) || 0;

      if (clave && descripcion && !isNaN(precioC) && !isNaN(existencia)) {
        const item = {
          clave,
          descripcion,
          precioC,
          existencia,
          marca: 'Test',
          supplierId: undefined
        };
        console.log('Created test item:', item);
        cleanedData.push(item);
      }
    }
  }

  console.log('Test version final result:', cleanedData.length, 'items');
  return cleanedData;
};
