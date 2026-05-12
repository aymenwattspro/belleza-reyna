import { InventoryItem, Supplier } from '../types/inventory';

/**
 * Normalizes column names to standard keys
 */
const normalizeKey = (key: string): string => {
  const k = key.toLowerCase().trim();
  if (k.includes('clave') || k.includes('sku') || k.includes('código') || k.includes('codigo')) return 'clave';
  if (k.includes('descripción') || k.includes('descripcion') || k.includes('nombre') || k.includes('producto')) return 'descripcion';
  if (k.includes('precio') || k.includes('costo') || k.includes('precio c')) return 'precioC';
  if (k.includes('existencia') || k.includes('stock') || k.includes('cantidad') || k.includes('inventario')) return 'existencia';
  if (k.includes('objetivo') || k.includes('stock_objetivo') || k.includes('meta')) return 'stockObjetivo';
  if (k.includes('piezas') || k.includes('empaque') || k.includes('multiplo')) return 'piezas';
  if (k.includes('departamento') || k.includes('departamento:')) return 'departamento';
  if (k.includes('proveedor') || k.includes('proveedor:')) return 'proveedor';
  return k;
};

/**
 * Cleans messy supplier inventory CSV data
 * Handles various CSV formats with flexible column detection
 */
export const cleanInventoryData = (rawData: any[], supplierName?: string): InventoryItem[] => {
  if (!rawData || rawData.length < 1) return [];

  const cleanedData: InventoryItem[] = [];
  let currentSupplierName = '';
  let currentProveedor = '';

  // Find the header row first - look for "Clave" and "Descripción" in any order
  let headerRow = -1;
  let claveIdx = -1;
  let descIdx = -1;
  let precioCIdx = -1;
  let existenciaIdx = -1;
  let precioVIdx = -1;

  console.log('Raw data preview:', rawData.slice(0, 10));
  console.log('Total rows:', rawData.length);

  // First pass: find the header row
  for (let i = 0; i < Math.min(rawData.length, 50); i++) {
    const row = rawData[i];
    if (!row || !Array.isArray(row)) {
      console.log('Skipping non-array row at index', i, row);
      continue;
    }

    console.log('Row', i, ':', row);

    // Check if this row contains both "Clave" and "Descripción/Descripcion" (in any order)
    const hasClave = row.some(cell => String(cell || '').toLowerCase().includes('clave'));
    const hasDesc = row.some(cell => {
      const cellLower = String(cell || '').toLowerCase();
      return cellLower.includes('descrip') || cellLower.includes('nombre') || cellLower.includes('producto');
    });
    
    if (hasClave && hasDesc) {
      headerRow = i;
      console.log('Found header row at index', i, 'row:', row);
      
      // Find all column indices - plus flexible comme dans le Python
      claveIdx = row.findIndex(cell => String(cell || '').toLowerCase().includes('clave'));
      descIdx = row.findIndex(cell => {
        const cellLower = String(cell || '').toLowerCase();
        return cellLower.includes('descrip') || cellLower.includes('nombre') || cellLower.includes('producto');
      });
      precioCIdx = row.findIndex(cell => {
        const cellLower = String(cell || '').toLowerCase();
        return cellLower.includes('precio c') || cellLower.includes('costo');
      });
      existenciaIdx = row.findIndex(cell => String(cell || '').toLowerCase().includes('exist'));
      precioVIdx = row.findIndex(cell => String(cell || '').toLowerCase().includes('precio v'));
      
      console.log('Column indices - Clave:', claveIdx, 'Desc:', descIdx, 'Precio C:', precioCIdx, 'Existencia:', existenciaIdx, 'Precio V:', precioVIdx);
      break;
    }
  }

  if (headerRow === -1) {
    console.log('No header row found in first 50 rows');
    return [];
  }

  // Second pass: look for supplier info before header row
  for (let i = 0; i < headerRow; i++) {
    const row = rawData[i];
    if (!row || !Array.isArray(row)) continue;

    // Look for "Departamento:" or supplier names
    const departamentoIdx = row.findIndex(cell => String(cell || '').toLowerCase().includes('departamento'));
    if (departamentoIdx >= 0 && row.length > departamentoIdx + 1) {
      // The proveedor/supplier is the first non-empty cell after "Departamento:"
      let supplierName = '';
      for (let j = departamentoIdx + 1; j < row.length; j++) {
        const cellValue = String(row[j] || '').trim();
        if (cellValue !== '') {
          supplierName = cellValue;
          break;
        }
      }
      currentProveedor = supplierName;
      currentSupplierName = supplierName;
      console.log('Found supplier info before header:', supplierName);
    }

    // Also check for any row that contains supplier info
    const hasSupplierInfo = row.some(cell => {
      const cellStr = String(cell || '').toLowerCase();
      return ['pink up', 'beauty creations', 'bissu', 'prosa', 'reyna'].some(supplier => 
        cellStr.includes(supplier) || supplier.includes(cellStr)
      );
    });
    
    if (hasSupplierInfo) {
      console.log('Found row with supplier info at index', i, row);
      // Try to extract supplier name from any cell that contains known supplier names
      const knownSuppliers = ['pink up', 'beauty creations', 'bissu', 'prosa', 'reyna'];
      for (let j = 0; j < row.length; j++) {
        const cellValue = String(row[j] || '').trim().toLowerCase();
        const matchedSupplier = knownSuppliers.find(s => 
          cellValue.includes(s) || s.includes(cellValue)
        );
        if (matchedSupplier) {
          currentProveedor = matchedSupplier.charAt(0).toUpperCase() + matchedSupplier.slice(1);
          currentSupplierName = currentProveedor;
          console.log('Extracted supplier from cell:', currentProveedor);
          break;
        }
      }
    }
  }

  // Third pass: parse data rows after header
  for (let i = headerRow + 1; i < rawData.length; i++) {
    const dataRow = rawData[i];
    if (!dataRow || !Array.isArray(dataRow) || dataRow.every(cell => cell === null || cell === '')) {
      console.log('Skipping empty data row at index', i);
      continue;
    }
    
    // Check if this is a new section (starts with Departamento or Reporte)
    // Au lieu de s'arrêter, on met à jour le fournisseur courant et on continue
    const firstCell = String(dataRow[0] || '').toLowerCase();
    if (firstCell.includes('departamento') || firstCell.includes('reporte')) {
      console.log('Found new section at index', i, '- looking for new supplier...');
      // Chercher le nouveau fournisseur dans cette ligne
      for (let j = 1; j < dataRow.length; j++) {
        const cellValue = String(dataRow[j] || '').trim();
        if (cellValue !== '') {
          currentProveedor = cellValue;
          currentSupplierName = cellValue;
          console.log('New supplier found:', cellValue);
          break;
        }
      }
      continue; // Continue to next row, don't break!
    }
    
    // Extract data from the correct column positions
    const claveVal = claveIdx >= 0 ? dataRow[claveIdx] : '';
    const descVal = descIdx >= 0 ? dataRow[descIdx] : '';
    
    if (!claveVal || String(claveVal).trim() === '') {
      console.log('Skipping row with empty clave at index', i, 'row:', dataRow);
      continue;
    }
    
    const claveStr = String(claveVal).trim().replace(/\.0$/, '');
    const descripcion = descVal ? String(descVal).trim() : '';
    
    // Skip if description looks like a header
    const desc = descripcion.toLowerCase();
    if (['página', 'pagina', 'reporte'].some(term => desc.includes(term))) {
      console.log('Skipping header row at index', i, 'description:', desc);
      continue;
    }
    
    // Additional check: skip if clave looks like a header or contains text
    const clave = String(claveVal).trim();
    if (['reporte', 'departamento', 'categoría', 'categoria', 'página'].some(term => clave.toLowerCase().includes(term))) {
      console.log('Skipping row with header-like clave at index', i, 'clave:', clave);
      continue;
    }
    
    const precioC = precioCIdx >= 0 && dataRow.length > precioCIdx 
      ? parseFloat(String(dataRow[precioCIdx] || '0').replace(/[^0-9.]/g, '')) || 0
      : 0;
    
    // Log pour vérifier la valeur brute d'Existencia
    const existenciaRaw = existenciaIdx >= 0 && dataRow.length > existenciaIdx ? dataRow[existenciaIdx] : undefined;
    const existencia = existenciaRaw !== undefined
      ? parseFloat(String(existenciaRaw || '0').replace(/[^0-9.]/g, '')) || 0
      : 0;
    
    if (cleanedData.length < 5) {
      console.log(`📦 CSV Row ${i}: clave=${claveStr}, existenciaRaw="${existenciaRaw}", existenciaParsed=${existencia}`);
    }
    
    const precioV = precioVIdx >= 0 && dataRow.length > precioVIdx 
      ? parseFloat(String(dataRow[precioVIdx] || '0').replace(/[^0-9.]/g, '')) || undefined
      : undefined;
    
    // Use provided supplierName if no proveedor found in data
    const finalProveedor = currentProveedor || supplierName || 'Desconocido';
    
    const item: InventoryItem = {
      clave: claveStr,
      descripcion,
      precioC,
      precioV,
      existencia,
      proveedor: finalProveedor,
    };
    
    if (cleanedData.length < 5) {
      console.log('✅ Created item:', item);
    }
    cleanedData.push(item);
  }

  console.log('Final cleaned data:', cleanedData.length, 'items');
  return cleanedData;
};

/**
 * Cleans stock target Excel data
 */
export const cleanStockTargetData = (rawData: any[]): Partial<InventoryItem>[] => {
  if (!rawData || rawData.length < 2) return [];

  // Assume first row is headers
  const headers = rawData[0];
  if (!Array.isArray(headers)) return [];

  const normalizedHeaders = headers.map(h => normalizeKey(String(h)));

  const cleanedData: Partial<InventoryItem>[] = [];

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || !Array.isArray(row)) continue;

    const item: any = {};
    normalizedHeaders.forEach((header, index) => {
      if (header) {
        item[header] = row[index];
      }
    });

    if (!item.clave) continue;

    const clave = String(item.clave).trim().replace(/\.0$/, '');

    cleanedData.push({
      clave,
      descripcion: String(item.descripcion || '').trim(),
      stockObjetivo: parseFloat(String(item.stockObjetivo || '0').replace(/[^0-9.]/g, '')) || 0,
      piezas: parseFloat(String(item.piezas || '1').replace(/[^0-9.]/g, '')) || 1,
    });
  }

  return cleanedData;
};

/**
 * Detects supplier from filename
 */
export const detectSupplier = (
  fileName: string, 
  managedSuppliers?: Supplier[]
): { name: string; minOrder: number; id: string } => {
  const lowerName = fileName.toLowerCase();
  
  if (managedSuppliers && managedSuppliers.length > 0) {
    const found = managedSuppliers.find(s => lowerName.includes(s.name.toLowerCase()));
    if (found) return { name: found.name, minOrder: found.minOrder, id: found.id };
  }

  const suppliers: Record<string, { min: number; id: string }> = {
    "pink up": { min: 5000, id: '1' },
    "beauty creations": { min: 8000, id: '2' },
    "bissu": { min: 10000, id: '3' },
    "prosa": { min: 3000, id: '4' },
    "reyna": { min: 0, id: '5' }
  };

  for (const [name, data] of Object.entries(suppliers)) {
    if (lowerName.includes(name)) {
      return { name: name.charAt(0).toUpperCase() + name.slice(1), minOrder: data.min, id: data.id };
    }
  }

  return { name: 'Desconocido', minOrder: 0, id: '' };
};

/**
 * Merges inventory and targets, then calculates purchase order
 * Implements the exact logic from the Python source
 */
/**
 * Processes Excel data with stock targets and piezas
 * Reads Excel format with flexible column detection
 */
export const processInventoryData = (rawData: any[]): Partial<InventoryItem>[] => {
  console.log('🔍 processInventoryData called with', rawData.length, 'rows');
  console.log('🔍 First row type:', typeof rawData[0], 'isArray:', Array.isArray(rawData[0]));
  console.log('🔍 First row:', rawData[0]);
  
  if (!rawData || rawData.length < 2) {
    console.warn('❌ rawData too short or empty');
    return [];
  }

  const headers = rawData[0];
  if (!Array.isArray(headers)) {
    console.warn('❌ Headers is not an array:', headers);
    return [];
  }

  // Detect column indices with flexible matching
  const normalizedHeaders = headers.map((h: string) => String(h).toLowerCase().trim());
  
  const claveIdx = normalizedHeaders.findIndex(h => h.includes('clave') || h.includes('sku'));
  const descIdx = normalizedHeaders.findIndex(h => h.includes('descrip') || h.includes('nombre'));
  // Plus flexible: cherche "objetivo" OU "stock" OU "exist" (comme dans le Python)
  const stockIdx = normalizedHeaders.findIndex(h => 
    h.includes('objetivo') || h.includes('meta') || h.includes('stock') || h.includes('exist')
  );
  const piezasIdx = normalizedHeaders.findIndex(h => h.includes('piezas') || h.includes('pz') || h.includes('empaque'));

  console.log('Excel headers detectados:', { headers: normalizedHeaders, claveIdx, descIdx, stockIdx, piezasIdx });

  if (claveIdx === -1 || descIdx === -1 || stockIdx === -1) {
    console.warn('❌ Columnas requeridas no encontradas en Excel:', { claveIdx, descIdx, stockIdx, piezasIdx });
    console.warn('Headers disponibles:', normalizedHeaders);
    return [];
  }

  const processedData: Partial<InventoryItem>[] = [];

  let debugCount = 0;
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || !Array.isArray(row)) {
      if (debugCount < 3) {
        console.log(`⚠️ Row ${i} is not an array:`, row);
        debugCount++;
      }
      continue;
    }

    const clave = String(row[claveIdx] || '').trim().replace(/\.0$/, '');
    if (!clave || clave === '') continue;

    const descripcion = String(row[descIdx] || '').trim();
    const stockObjetivoRaw = row[stockIdx];
    const stockObjetivo = parseFloat(String(stockObjetivoRaw || '0').replace(/[^0-9.]/g, '')) || 0;
    const piezas = piezasIdx >= 0 ? (parseFloat(String(row[piezasIdx] || '1').replace(/[^0-9.]/g, '')) || 1) : 1;

    // Debug: log first few rows and any zero stock objetivo
    if (i <= 3 || stockObjetivo === 0) {
      console.log(`Row ${i}: clave=${clave}, stockRaw=${stockObjetivoRaw}, stock=${stockObjetivo}, row[${stockIdx}]=`, row[stockIdx]);
    }

    processedData.push({
      clave,
      descripcion,
      stockObjetivo,
      piezas
    });
  }

  console.log('Processed Excel data:', processedData.length, 'items');
  return processedData;
};

/**
 * Calculate purchase orders - EXACT Python translation
 * Steps:
 * 1. Validate Piezas column exists
 * 2. Convert Piezas to numeric (errors='coerce')
 * 3. Calculate Pedido_base = max(Stock_objetivo - Existencia, 0)
 * 4. Apply ajustar_pedido(Pedido_base, Piezas)
 * 5. Calculate Valor_pedido = Pedido * Precio C. (fillna 0)
 */
export const calculatePurchaseOrders = (inventory: InventoryItem[]): InventoryItem[] => {
  // Step 1: Validate Piezas exists (check if any item has piezas defined)
  const hasPiezasColumn = inventory.some(item => item.piezas !== undefined);
  if (!hasPiezasColumn) {
    console.error("❌ No se encontró la columna 'Piezas'");
    console.error("Columnas detectadas:", Object.keys(inventory[0] || {}));
    // Return items with pedido = 0
    return inventory.map(item => ({ ...item, pedido: 0, valorPedido: 0 }));
  }

  // Helper function: ajustar_pedido (EXACT Python translation)
  const ajustarPedido = (pedido: number, piezas: number): number => {
    // if pd.isna(pedido) or pd.isna(piezas) or piezas <= 0:
    if (!isFinite(pedido) || isNaN(pedido) || !isFinite(piezas) || isNaN(piezas) || piezas <= 0) {
      return 0;
    }

    // si es menor al 50% → no pedir
    if (pedido < (piezas / 2)) {
      return 0;
    }

    // multiplo_abajo = (pedido // piezas) * piezas
    const multiploAbajo = Math.floor(pedido / piezas) * piezas;
    const multiploArriba = multiploAbajo + piezas;

    // elegir el más cercano
    if ((pedido - multiploAbajo) < (multiploArriba - pedido)) {
      return Math.floor(multiploAbajo);
    } else {
      return Math.floor(multiploArriba);
    }
  };

  // Step 2 & 3 & 4: Convert Piezas + Calculate Pedido_base + Apply ajustar_pedido
  const withPedido = inventory.map(item => {
    // Convert Piezas to numeric like pd.to_numeric(errors='coerce')
    let piezas = Number(item.piezas);
    if (!isFinite(piezas) || isNaN(piezas)) {
      piezas = 0; // NaN in pandas becomes 0
    }

    const stockObjetivo = item.stockObjetivo ?? 0;
    const existencia = item.existencia ?? 0;

    // Calculate Pedido_base
    const pedidoBase = Math.max(stockObjetivo - existencia, 0);

    // Apply ajustar_pedido
    const pedido = ajustarPedido(pedidoBase, piezas);

    return {
      ...item,
      piezas,
      pedidoBase,
      pedido
    };
  });

  // Step 5: Calculate Valor_pedido = Pedido * Precio C. (fillna 0)
  return withPedido.map(item => {
    const valorPedidoRaw = (item.pedido || 0) * (item.precioC || 0);
    // fillna(0) - if NaN or undefined, use 0
    const valorPedido = isFinite(valorPedidoRaw) && !isNaN(valorPedidoRaw) ? valorPedidoRaw : 0;

    return {
      ...item,
      valorPedido
    };
  });
};

/**
 * Legacy function - kept for compatibility
 */
export const processPurchaseOrders = calculatePurchaseOrders;
