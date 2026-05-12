// Parsers for Inventory Timeline data — Robust multi-page CSV/Excel support
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { ProductSnapshot } from '@/lib/types/inventory-timeline';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface ColMapping {
  claveIdx: number;
  descIdx: number;
  existenciaIdx: number;
  precioCIdx: number;
  precioVIdx: number;
  proveedorIdx: number;
  stockObjetivoIdx: number;
  piezasIdx: number;
  headerRowIndex: number;
  headers: string[];
}

export interface ParsePreview {
  mapping: ColMapping;
  sampleRows: string[][];  // First 5 raw data rows (as strings)
  allHeaders: string[];    // All detected header cells
  detectedSupplier: string;
  totalRows: number;       // Total data rows in file
  rawRows: string[][];     // All raw rows for re-parsing after user adjusts mapping
}

// --------------------------------------------------------------------------
// Utility: normalise a string for header matching
// --------------------------------------------------------------------------
const norm = (s: string) => String(s ?? '').toLowerCase().trim();

// --------------------------------------------------------------------------
// Auto-detect column indices from a header row
// --------------------------------------------------------------------------
export function detectColumns(headerRow: string[]): Omit<ColMapping, 'headerRowIndex'> {
  const h = headerRow.map(norm);

  const find = (...patterns: string[]) =>
    h.findIndex((cell) => patterns.some((p) => cell.includes(p)));

  const claveIdx = find('clave', 'sku', 'codigo', 'barcode', 'referencia', 'ref.');
  const descIdx = find('descrip', 'nombre', 'producto', 'articulo', 'art.');
  const existenciaIdx = h.findIndex(cell =>
    ['existencia', 'stock', 'cantidad', 'qty'].some(p => cell.includes(p)) ||
    (cell.includes('exist') && !cell.includes('parcial') && !cell.includes('acum'))
  );
  const precioCIdx = find('precio c', 'costo', 'cost', 'compra', 'p. costo');
  const precioVIdx = find('precio v', 'venta', 'sale', 'p. venta', 'precio s');
  const proveedorIdx = find('proveedor', 'supplier', 'marca', 'brand');
  const stockObjetivoIdx = find('stock_objetivo', 'target', 'objetivo', 'minimo', 'mínimo', 'min');
  const piezasIdx = find('piezas', 'pz', 'empaque', 'paquete', 'unidades', 'pieces', 'qty/case');

  return {
    claveIdx,
    descIdx,
    existenciaIdx,
    precioCIdx,
    precioVIdx,
    proveedorIdx,
    stockObjetivoIdx,
    piezasIdx,
    headers: headerRow,
  };
}

// --------------------------------------------------------------------------
// Check if a row is a page-break / report-metadata row (not a product)
// --------------------------------------------------------------------------
function isMetaRow(row: string[]): boolean {
  const cell0 = norm(row[0] ?? '');
  if (!cell0) return true; // Empty first cell

  const metaPatterns = [
    'reporte', 'departamento', 'categoria', 'categoría', 'pagina', 'página',
    'generado', 'fecha', 'grupo', 'sucursal', 'total', 'subtotal',
    'clave', 'sku', 'descrip', 'articulo', 'almacen', 'almacén',
  ];
  // If the first cell looks like a label (contains meta keywords)
  if (metaPatterns.some((p) => cell0.includes(p))) return true;

  // If the second column contains text like "de" (Página X de Y)
  const cell1 = norm(row[1] ?? '');
  if (cell0.includes('pag') && cell1.includes('de')) return true;

  return false;
}

// --------------------------------------------------------------------------
// Normalise a raw clave/barcode string coming from Excel.
// Excel often renders large integers in scientific notation (6.00E+11).
// We convert those back to their full integer representation so that
// "6.00E+11", "6E+11", and "600000000000" all resolve to the same key.
// --------------------------------------------------------------------------
function normalizeClaveStr(raw: string): string {
  // Match things like "6.00E+11", "7.5E+12", "6E11", "6e+11"
  if (/^[\d.]+[eE][+\-]?\d+$/.test(raw)) {
    const n = parseFloat(raw);
    if (!isNaN(n) && isFinite(n) && n > 0) {
      return Math.round(n).toString();
    }
  }
  return raw;
}

// --------------------------------------------------------------------------
// Parse a single row of data into a ProductSnapshot using the column mapping
// --------------------------------------------------------------------------
function parseProductRow(
  row: string[],
  mapping: ColMapping,
  defaultSupplier: string
): ProductSnapshot | null {
  const get = (idx: number) => String(row[idx] ?? '').trim();
  const num = (idx: number) =>
    idx >= 0 ? parseFloat(get(idx).replace(/[^0-9.-]/g, '')) || 0 : 0;

  const clave = get(mapping.claveIdx);
  const descripcion = get(mapping.descIdx);

  // Validate: must have a non-empty clave and description to be a product row
  if (!clave || !descripcion) return null;
  if (clave.length < 2) return null;           // Too short — likely garbage
  if (isMetaRow(row)) return null;             // Skip meta/header rows

  const existencia = mapping.existenciaIdx >= 0 ? num(mapping.existenciaIdx) : 0;
  const precioC = mapping.precioCIdx >= 0 ? num(mapping.precioCIdx) : 0;
  const precioV = mapping.precioVIdx >= 0 ? num(mapping.precioVIdx) || undefined : undefined;
  const proveedor =
    mapping.proveedorIdx >= 0 ? get(mapping.proveedorIdx) || defaultSupplier : defaultSupplier;
  const stockObjetivo =
    mapping.stockObjetivoIdx >= 0 ? num(mapping.stockObjetivoIdx) || undefined : undefined;
  const piezas = mapping.piezasIdx >= 0 ? num(mapping.piezasIdx) || undefined : undefined;

  return { clave, descripcion, existencia, precioC, precioV, proveedor, stockObjetivo, piezas };
}

// --------------------------------------------------------------------------
// Find the header row in the raw rows (search first 30 rows)
// --------------------------------------------------------------------------
function findHeaderRow(rows: string[][]): { idx: number; mapping: ColMapping } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    if (!row || row.length < 2) continue;
    const mapping = detectColumns(row);
    // A valid header must have at least reference/clave + description.
    // Stock/existencia is now optional — the user can map it manually.
    if (mapping.claveIdx >= 0 && mapping.descIdx >= 0) {
      return { idx: i, mapping: { ...mapping, headerRowIndex: i } };
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Detect supplier name from the first few rows
// --------------------------------------------------------------------------
function detectSupplier(rows: string[][], headerIdx: number): string {
  const knownSuppliers = [
    'pink up', 'beauty creations', 'bissu', 'prosa', 'vogue', 'rimmel',
    'l\'oreal', "l'oreal", 'nyx', 'wet n wild', 'maybelline', 'revlon',
  ];
  for (let i = 0; i < Math.min(headerIdx + 1, rows.length); i++) {
    const text = rows[i].join(' ').toLowerCase();
    for (const sup of knownSuppliers) {
      if (text.includes(sup)) {
        return sup.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }
  }
  return 'General';
}

// --------------------------------------------------------------------------
// Detect supplier name from filename
// --------------------------------------------------------------------------
function detectSupplierFromFilename(fileName: string): string {
  const normalized = fileName.toLowerCase().replace(/[._\-]/g, ' ');
  const knownSuppliers: { patterns: string[]; displayName: string }[] = [
    { patterns: ['pink up', 'pinkup'], displayName: 'Pink Up' },
    { patterns: ['beauty creation', 'beautycreation'], displayName: 'Beauty Creations' },
    { patterns: ['bissu'], displayName: 'Bissu' },
    { patterns: ['prosa'], displayName: 'Prosa' },
    { patterns: ['vogue'], displayName: 'Vogue' },
    { patterns: ['rimmel'], displayName: 'Rimmel' },
    { patterns: ['loreal', 'l oreal'], displayName: "L'Oreal" },
    { patterns: ['nyx'], displayName: 'NYX' },
    { patterns: ['wet n wild', 'wetnwild'], displayName: 'Wet n Wild' },
    { patterns: ['maybelline'], displayName: 'Maybelline' },
    { patterns: ['revlon'], displayName: 'Revlon' },
  ];
  for (const { patterns, displayName } of knownSuppliers) {
    if (patterns.some(p => normalized.includes(p))) return displayName;
  }
  return 'General';
}

// --------------------------------------------------------------------------
// MAIN: Parse CSV text with multi-page support
// Returns ParsePreview for guided import mode, or products directly
// --------------------------------------------------------------------------
export function parseCSVToPreview(csvText: string, fileName?: string): ParsePreview {
  const parseResult = Papa.parse(csvText, {
    header: false,
    skipEmptyLines: 'greedy',
    delimiter: '',        // Auto-detect: comma, semicolon, tab
    quoteChar: '"',
    dynamicTyping: false,
  });

  const allRows = parseResult.data as string[][];

  const found = findHeaderRow(allRows);
  if (!found) {
    throw new Error(
      'Could not detect column headers. Please ensure your file has columns: Clave/SKU, Description, Stock/Existencia.'
    );
  }

  const { idx: headerIdx, mapping } = found;
  // Prefer content-based detection; fall back to filename if content says 'General'
  let detectedSupplier = detectSupplier(allRows, headerIdx);
  if (detectedSupplier === 'General' && fileName) {
    const fromFilename = detectSupplierFromFilename(fileName);
    if (fromFilename !== 'General') detectedSupplier = fromFilename;
  }

  // Gather data rows (after header)
  const dataRows = allRows.slice(headerIdx + 1);

  // Sample rows: first 5 that look like product rows
  const sampleRows: string[][] = [];
  for (const row of dataRows) {
    if (sampleRows.length >= 5) break;
    const clave = String(row[mapping.claveIdx] ?? '').trim();
    const desc = String(row[mapping.descIdx] ?? '').trim();
    if (clave && desc && !isMetaRow(row)) sampleRows.push(row);
  }

  return {
    mapping,
    sampleRows,
    allHeaders: mapping.headers,
    detectedSupplier,
    totalRows: dataRows.length,
    rawRows: allRows,
  };
}

// --------------------------------------------------------------------------
// Convert preview + (optionally adjusted) mapping into ProductSnapshot[]
// --------------------------------------------------------------------------
export function applyMappingToRows(
  rawRows: string[][],
  mapping: ColMapping,
  supplierName: string
): ProductSnapshot[] {
  const products: ProductSnapshot[] = [];
  const seenClaves = new Set<string>();

  for (let i = mapping.headerRowIndex + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const product = parseProductRow(row, mapping, supplierName);
    if (!product) continue;

    // Skip exact duplicate claves within the same file
    if (seenClaves.has(product.clave)) continue;
    seenClaves.add(product.clave);

    products.push(product);
  }

  return products;
}

// --------------------------------------------------------------------------
// Parse Excel / XLSX file — returns ParsePreview
// --------------------------------------------------------------------------
export function parseExcelToPreview(buffer: ArrayBuffer, fileName: string): ParsePreview {
  const workbook = XLSX.read(buffer, { type: 'array', codepage: 1252 });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // raw: true returns actual numeric values (e.g. 600100800102 not "6.00101E+11")
  // We immediately stringify every cell so the rest of the pipeline stays typed as string[][]
  const rawValues = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: '',
  }) as any[][];

  const jsonRows: string[][] = rawValues.map(row =>
    (row as any[]).map(cell => {
      if (cell === null || cell === undefined) return '';
      // Numbers: use exact integer representation for barcodes
      if (typeof cell === 'number') return Number.isInteger(cell) ? cell.toString() : String(cell);
      return String(cell);
    })
  );

  // Find header row
  const found = findHeaderRow(jsonRows);
  if (!found) {
    throw new Error(
      'Could not detect column headers in the Excel file. Please ensure it has: Clave, Description, Existencia columns.'
    );
  }

  const { idx: headerIdx, mapping } = found;
  // Prefer content-based detection; fall back to filename if content says 'General'
  let detectedSupplier = detectSupplier(jsonRows, headerIdx);
  if (detectedSupplier === 'General' && fileName) {
    const fromFilename = detectSupplierFromFilename(fileName);
    if (fromFilename !== 'General') detectedSupplier = fromFilename;
  }

  const dataRows = jsonRows.slice(headerIdx + 1);
  const sampleRows: string[][] = [];
  for (const row of dataRows) {
    if (sampleRows.length >= 5) break;
    const clave = String(row[mapping.claveIdx] ?? '').trim();
    const desc = String(row[mapping.descIdx] ?? '').trim();
    if (clave && desc && !isMetaRow(row)) sampleRows.push(row);
  }

  return {
    mapping,
    sampleRows,
    allHeaders: mapping.headers,
    detectedSupplier,
    totalRows: dataRows.length,
    rawRows: jsonRows,
  };
}

// --------------------------------------------------------------------------
// Parse Config Excel/CSV (Stock Objetivo / Target Stock)
// --------------------------------------------------------------------------
export function parseConfigFile(
  fileBuffer: ArrayBuffer,
  fileName: string
): Map<string, { stockObjetivo: number; piezas: number; descripcion?: string }> {
  const workbook = XLSX.read(fileBuffer, { type: 'array', codepage: 1252 });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false, defval: '' }) as string[][];

  if (!jsonData || jsonData.length < 2) {
    throw new Error('The configuration file is empty or has an incorrect format.');
  }

  // Find header row
  const found = findHeaderRow(jsonData);
  if (!found) {
    // Fallback: assume row 0 is headers
    const headers = jsonData[0].map(norm);
    const claveIdx = headers.findIndex((h) => h.includes('clave') || h.includes('sku'));
    if (claveIdx === -1) {
      throw new Error(
        `Could not find a "Clave" or "SKU" column. Detected columns: ${jsonData[0].join(', ')}`
      );
    }
  }

  const headerRow = found ? jsonData[found.idx] : jsonData[0];
  const mapping = detectColumns(headerRow);
  const startRow = found ? found.idx + 1 : 1;

  const configMap = new Map<string, { stockObjetivo: number; piezas: number; descripcion?: string }>();

  for (let i = startRow; i < jsonData.length; i++) {
    const row = jsonData[i];
    if (!row || row.length === 0) continue;

    const clave = String(row[mapping.claveIdx] ?? '').trim().replace(/\.0$/, '');
    if (!clave || clave.length < 2) continue;

    const stockObjetivo =
      mapping.stockObjetivoIdx >= 0
        ? parseFloat(String(row[mapping.stockObjetivoIdx] ?? '0').replace(/[^0-9.]/g, '')) || 0
        : 0;

    const piezas =
      mapping.piezasIdx >= 0
        ? parseFloat(String(row[mapping.piezasIdx] ?? '1').replace(/[^0-9.]/g, '')) || 1
        : 1;

    const descripcion =
      mapping.descIdx >= 0 ? String(row[mapping.descIdx] ?? '').trim() : undefined;

    configMap.set(clave, { stockObjetivo, piezas, descripcion });
  }

  return configMap;
}

// --------------------------------------------------------------------------
// Merge inventory with config data
// --------------------------------------------------------------------------
export function mergeWithConfig(
  inventory: ProductSnapshot[],
  config: Map<string, { stockObjetivo: number; piezas: number; descripcion?: string }>
): ProductSnapshot[] {
  return inventory.map((product) => {
    const configData = config.get(product.clave);
    if (configData) {
      return {
        ...product,
        stockObjetivo: configData.stockObjetivo || product.stockObjetivo,
        piezas: configData.piezas || product.piezas,
        descripcion: product.descripcion || configData.descripcion || product.clave,
      };
    }
    return product;
  });
}

// --------------------------------------------------------------------------
// Backward-compatible shim — wraps old single-call API
// --------------------------------------------------------------------------
/** @deprecated Use parseCSVToPreview + applyMappingToRows for guided import */
export function parseInventoryCSV(csvText: string): ProductSnapshot[] {
  try {
    const preview = parseCSVToPreview(csvText);
    return applyMappingToRows(preview.rawRows, preview.mapping, preview.detectedSupplier);
  } catch (e) {
    console.error('parseInventoryCSV error:', e);
    return [];
  }
}

// --------------------------------------------------------------------------
// Quick hash of a product list for duplicate detection
// --------------------------------------------------------------------------
export function hashProducts(products: ProductSnapshot[]): string {
  const sig = products
    .slice(0, 20)
    .map((p) => `${p.clave}:${p.existencia}`)
    .join('|');
  let hash = 0;
  for (let i = 0; i < sig.length; i++) {
    hash = ((hash << 5) - hash + sig.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
