// Parser for Stock Target Excel files (FORMATO PINK UP MARZO261.xlsx)
import * as XLSX from 'xlsx';

interface StockTarget {
  clave: string;
  stockObjetivo: number;
  piezas: number;
  descripcion?: string;
  proveedor?: string;
}

/**
 * Parse Stock Target Excel file
 * - Extracts: Clave, Stock Objetivo, Piezas, Descripcion, Proveedor
 */
export function parseStockTargetExcel(file: File): Promise<StockTarget[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get first worksheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
          header: 1,
          defval: '',
          blankrows: false
        }) as string[][];

        // Find header row
        let headerRowIndex = -1;
        let claveIdx = -1;
        let stockObjIdx = -1;
        let piezasIdx = -1;
        let descIdx = -1;
        let proveedorIdx = -1;

        for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;

          const normalizedRow = row.map(cell => String(cell || '').toLowerCase().trim());

          claveIdx = normalizedRow.findIndex(cell => 
            cell.includes('clave') || cell.includes('sku') || cell.includes('código')
          );
          stockObjIdx = normalizedRow.findIndex(cell => 
            cell.includes('stock') && cell.includes('obj') || 
            cell.includes('objetivo') || cell.includes('meta')
          );
          piezasIdx = normalizedRow.findIndex(cell => 
            cell.includes('pieza') || cell.includes('unidad') || cell.includes('lote')
          );
          descIdx = normalizedRow.findIndex(cell => 
            cell.includes('descrip') || cell.includes('nombre') || cell.includes('producto')
          );
          proveedorIdx = normalizedRow.findIndex(cell => 
            cell.includes('proveedor') || cell.includes('marca') || cell.includes('supplier')
          );

          if (claveIdx !== -1 && stockObjIdx !== -1) {
            headerRowIndex = i;
            break;
          }
        }

        if (headerRowIndex === -1) {
          throw new Error('No se encontraron las columnas requeridas. Verifica que el archivo tenga: Clave, Stock Objetivo');
        }

        // Extract supplier name from filename or content
        const filename = file.name.toLowerCase();
        let detectedSupplier = 'General';
        if (filename.includes('pink up')) detectedSupplier = 'Pink Up';
        else if (filename.includes('beauty creations')) detectedSupplier = 'Beauty Creations';
        else if (filename.includes('bissu')) detectedSupplier = 'Bissu';
        else if (filename.includes('prosa')) detectedSupplier = 'Prosa';

        // Parse data rows
        const stockTargets: StockTarget[] = [];

        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;

          const clave = String(row[claveIdx] || '').trim();
          if (!clave || clave.length < 3) continue;

          const stockObjetivoRaw = row[stockObjIdx];
          const stockObjetivoValue = parseFloat(String(stockObjetivoRaw || '0').replace(/[^0-9.-]/g, '')) || 0;

          const piezasRaw = piezasIdx !== -1 ? row[piezasIdx] : '1';
          const piezas = parseFloat(String(piezasRaw || '1').replace(/[^0-9.-]/g, '')) || 1;

          const descripcion = descIdx !== -1 ? String(row[descIdx] || '').trim() : '';
          const proveedor = proveedorIdx !== -1 
            ? String(row[proveedorIdx] || '').trim() || detectedSupplier
            : detectedSupplier;

          if (clave && !isNaN(stockObjetivoValue) && stockObjetivoValue > 0) {
            stockTargets.push({
              clave,
              stockObjetivo: stockObjetivoValue,
              piezas,
              descripcion,
              proveedor
            });
          }
        }

        if (stockTargets.length === 0) {
          throw new Error('No se encontraron datos válidos en el archivo');
        }

        resolve(stockTargets);
      } catch (error) {
        reject(new Error(`Error parsing Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    };

    reader.onerror = () => reject(new Error('Error reading file'));
    reader.readAsArrayBuffer(file);
  });
}
