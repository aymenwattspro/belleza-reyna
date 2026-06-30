'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  ImportManager — single, reusable inventory-import flow
//
//  Owns the hidden file input + the guided import modal + the persistence logic
//  (snapshot / target-stock) so EVERY page that needs an "Import" button can
//  reuse the exact same behavior without duplicating ~270 lines of modal code.
//
//  Usage (render-prop):
//      <ImportManager>
//        {(openImport) => <button onClick={openImport}>Import</button>}
//      </ImportManager>
//
//  The trigger you render is wired to a file picker; once a file is parsed the
//  guided mapping modal opens, and on confirm the data is written through the
//  InventoryContext (Supabase = source of truth).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { CheckCircle, AlertCircle, X, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useInventory } from '@/contexts/InventoryContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSuppliers } from '@/contexts/SupplierContext';
import { cleanSupplierName, resolveSupplierName } from '@/lib/utils/supplier';
import {
  parseCSVToPreview, parseExcelToPreview, applyMappingToRows,
  hashProducts, ParsePreview, ColMapping,
} from '@/lib/utils/timeline-parsers';
import { InventorySnapshot } from '@/lib/types/inventory-timeline';

interface ColField { key: keyof ColMapping; labelKey: string; required?: boolean; }

/** Inventory Snapshot: ref, description, stock, cost, sale only */
const SNAPSHOT_COL_FIELDS: ColField[] = [
  { key: 'claveIdx',      labelKey: 'import_col_ref',   required: true },
  { key: 'descIdx',       labelKey: 'import_col_desc',  required: true },
  { key: 'existenciaIdx', labelKey: 'import_col_stock' },
  { key: 'precioCIdx',    labelKey: 'import_col_cost' },
  { key: 'precioVIdx',    labelKey: 'import_col_sale' },
];

/** Target Stock Only: ref, description, target, units per case only */
const TARGET_COL_FIELDS: ColField[] = [
  { key: 'claveIdx',         labelKey: 'import_col_ref',    required: true },
  { key: 'descIdx',          labelKey: 'import_col_desc',   required: true },
  { key: 'stockObjetivoIdx', labelKey: 'import_col_target' },
  { key: 'piezasIdx',        labelKey: 'import_col_units' },
];

type ImportMode = 'snapshot' | 'targetstock';

const DEFAULT_SUPPLIER_NAMES = [
  'General', 'Pink Up', 'Beauty Creations', 'Bissu', 'Prosa', 'Vogue', 'Maybelline', "L'Oreal", 'NYX',
];

interface GuidedImportProps {
  preview: ParsePreview;
  supplierName: string;
  isImporting: boolean;
  onConfirm: (mapping: ColMapping, supplier: string, mode: ImportMode) => void;
  onCancel: () => void;
}

function GuidedImportModal({ preview, supplierName, isImporting, onConfirm, onCancel }: GuidedImportProps) {
  const { t } = useLanguage();
  const { suppliers } = useSuppliers();
  const [importMode, setImportMode] = useState<ImportMode>('snapshot');
  const [mapping, setMapping] = useState<ColMapping>({ ...preview.mapping });
  const [localSupplier, setLocalSupplier] = useState(supplierName);
  const [customSupplier, setCustomSupplier] = useState('');

  // Merge the built-in defaults with the user's permanent supplier database
  const supplierOptions = useMemo(() => {
    const names = [...DEFAULT_SUPPLIER_NAMES, ...suppliers.map((s) => s.name)];
    // Ensure the detected supplier is always selectable
    if (supplierName && supplierName !== '__custom__') names.push(supplierName);
    return Array.from(new Set(names.filter(Boolean)));
  }, [suppliers, supplierName]);

  useEffect(() => {
    if (importMode === 'targetstock') {
      setMapping({
        ...preview.mapping,
        existenciaIdx: -1,
        precioCIdx: -1,
        precioVIdx: -1,
      });
    } else {
      setMapping({
        ...preview.mapping,
        stockObjetivoIdx: -1,
        piezasIdx: -1,
      });
    }
  }, [importMode, preview.mapping]);

  const visibleColFields = useMemo(
    () => (importMode === 'targetstock' ? TARGET_COL_FIELDS : SNAPSHOT_COL_FIELDS),
    [importMode],
  );

  const setField = (field: keyof ColMapping, value: number) => setMapping((prev) => ({ ...prev, [field]: value }));

  const estimatedCount = useMemo(() => {
    try { return applyMappingToRows(preview.rawRows, mapping, localSupplier || 'General').length; }
    catch { return 0; }
  }, [preview.rawRows, mapping, localSupplier]);

  const effectiveSupplier = customSupplier || localSupplier;
  const nonEmptyHeaders = preview.allHeaders.map((h, i) => ({ h, i })).filter(({ h }) => h && h.trim() !== '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      {/* Loading overlay — shown while the import is being written to the
          database so the user gets clear feedback instead of a frozen modal. */}
      {isImporting && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-white/80 backdrop-blur-sm">
          <RefreshCw className="w-9 h-9 text-pink-500 animate-spin" />
          <p className="text-sm font-semibold text-gray-700">{t('import_loading')}</p>
        </div>
      )}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              📦 {importMode === 'targetstock' ? t('hub_import_targets') : t('hub_import_inventory')}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">~{estimatedCount} {t('import_products_ready')}</p>
          </div>
          <button onClick={onCancel} disabled={isImporting} className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">{t('import')}</label>
            <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
              <button type="button" onClick={() => setImportMode('snapshot')}
                className={cn('flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-all',
                  importMode === 'snapshot' ? 'bg-white text-pink-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                {t('import_mode_snapshot')}
              </button>
              <button type="button" onClick={() => setImportMode('targetstock')}
                className={cn('flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-all',
                  importMode === 'targetstock' ? 'bg-white text-pink-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                {t('import_mode_target')}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {importMode === 'targetstock' ? t('import_mode_target_hint') : t('import_mode_snapshot_hint')}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">{t('import_supplier_name')}</label>
            <div className="flex gap-2">
              <select value={localSupplier} onChange={(e) => { setLocalSupplier(e.target.value); setCustomSupplier(''); }}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400">
                {supplierOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
                <option value="__custom__">{t('import_add_new_supplier')}</option>
              </select>

              {localSupplier === '__custom__' && (
                <input value={customSupplier} onChange={(e) => setCustomSupplier(e.target.value)}
                  placeholder={t('import_type_supplier_name')}
                  className="flex-1 px-3 py-2 rounded-lg border border-pink-200 text-sm outline-none focus:border-pink-400" />
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">{t('import_col_mapping')}</label>
            <p className="text-xs text-gray-400 mb-3">{t('import_detected_headers')}: {preview.allHeaders.filter(Boolean).join(', ')}</p>
            <div className="grid grid-cols-2 gap-3">
              {visibleColFields.map(({ key, labelKey, required }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-1">{t(labelKey as Parameters<typeof t>[0])}{required && <span className="text-red-500 ml-1">*</span>}</label>
                  <select value={(mapping as any)[key]} onChange={(e) => setField(key as keyof ColMapping, parseInt(e.target.value))}
                    className={cn('w-full px-2 py-1.5 rounded-lg border text-xs outline-none',
                      required && (mapping as any)[key] === -1 ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-pink-400')}>
                    <option value={-1}>{t('import_not_mapped')}</option>
                    {nonEmptyHeaders.map(({ h, i }) => <option key={i} value={i}>{t('import_col')} {i + 1}: {h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {preview.sampleRows.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">{t('import_data_preview')}</label>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="text-xs w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">{t('import_ref_sku')}</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">{t('orders_description')}</th>
                      {importMode === 'snapshot' ? (
                        <>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">{t('inv_stock')}</th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">{t('import_col_cost')}</th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">{t('import_col_sale')}</th>
                        </>
                      ) : (
                        <>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">{t('import_col_target')}</th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">{t('import_col_units')}</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-gray-700">{mapping.claveIdx >= 0 ? (row[mapping.claveIdx] || '—') : '—'}</td>
                        <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate">{mapping.descIdx >= 0 ? (row[mapping.descIdx] || '—') : '—'}</td>
                        {importMode === 'snapshot' ? (
                          <>
                            <td className="px-3 py-2 text-right font-medium text-gray-700">{mapping.existenciaIdx >= 0 ? (row[mapping.existenciaIdx] || '0') : '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{mapping.precioCIdx >= 0 ? (row[mapping.precioCIdx] || '—') : '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{mapping.precioVIdx >= 0 ? (row[mapping.precioVIdx] || '—') : '—'}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2 text-right font-medium text-gray-700">{mapping.stockObjetivoIdx >= 0 ? (row[mapping.stockObjetivoIdx] || '—') : '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{mapping.piezasIdx >= 0 ? (row[mapping.piezasIdx] || '—') : '—'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className={cn('rounded-xl p-4 flex items-center gap-3',
            estimatedCount > 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200')}>
            {estimatedCount > 0 ? <CheckCircle size={18} className="text-emerald-600 shrink-0" /> : <AlertCircle size={18} className="text-amber-600 shrink-0" />}
            <div>
              <p className={cn('text-sm font-semibold', estimatedCount > 0 ? 'text-emerald-700' : 'text-amber-700')}>
                {estimatedCount > 0 ? `${estimatedCount} ${t('import_products_ready')}` : t('import_no_products_detected')}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">~{preview.totalRows} {t('import_data_rows')}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onCancel} disabled={isImporting} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed">{t('cancel')}</button>
          <button
            onClick={() => {
              const effectiveMapping = importMode === 'targetstock' ? { ...mapping, existenciaIdx: -1 } : mapping;
              onConfirm(effectiveMapping, effectiveSupplier, importMode);
            }}
            disabled={estimatedCount === 0 || isImporting}
            className="px-5 py-2 bg-pink-500 text-white text-sm font-semibold rounded-xl hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2">
            {isImporting && <RefreshCw size={14} className="animate-spin" />}
            {isImporting ? t('import_loading') : `${t('import')} ${estimatedCount}`}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ImportManagerProps {
  /** Render-prop for the trigger; receives an `open()` callback that launches the file picker. */
  children: (open: () => void) => React.ReactNode;
  /** Optional callback fired after a successful import (snapshot or target stock). */
  onImported?: () => void;
}

export function ImportManager({ children, onImported }: ImportManagerProps) {
  const { addSnapshot, checkFileDuplicate, updateTargetStock, recordTargetImport } = useInventory();

  const { addSupplierByName } = useSuppliers();
  const { t } = useLanguage();

  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [pendingSupplier, setPendingSupplier] = useState('General');
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const open = useCallback(() => importInputRef.current?.click(), []);

  const handleFileSelect = useCallback(async (file: File) => {
    try {
      let prev: ParsePreview;
      if (file.name.endsWith('.csv')) { const text = await file.text(); prev = parseCSVToPreview(text, file.name); }
      else { const buf = await file.arrayBuffer(); prev = parseExcelToPreview(buf, file.name); }
      setPendingSupplier(prev.detectedSupplier);
      setPreview(prev);
    } catch (e: any) { toast.error(e.message || t('import_failed')); }
  }, [t]);

  const handleConfirmImport = useCallback(async (mapping: ColMapping, supplier: string, mode: ImportMode) => {
    if (!preview) return;
    setIsImporting(true);
    try {
      // Canonicalize the chosen supplier once so the snapshot, the saved
      // supplier record and every product row all agree on the exact name.
      const supplierLabel = resolveSupplierName(supplier);
      const effectiveMapping = mode === 'targetstock' ? { ...mapping, existenciaIdx: -1 } : mapping;
      const products = applyMappingToRows(preview.rawRows, effectiveMapping, supplierLabel);
      if (products.length === 0) { toast.error(t('import_no_valid_products')); return; }

      // Persist the supplier permanently so it can be reused in future orders
      const cleanedSupplier = cleanSupplierName(supplier);
      if (cleanedSupplier) { await addSupplierByName(cleanedSupplier); }

      if (mode === 'targetstock') {
        const targetUpdates = new Map<string, { stockObjetivo: number; piezas: number; descripcion?: string; proveedor?: string }>();
        products.forEach((p) => {
          if (p.stockObjetivo != null || p.piezas != null) {
            targetUpdates.set(p.clave, {
              stockObjetivo: p.stockObjetivo ?? 0,
              piezas: p.piezas ?? 1,
              descripcion: p.descripcion,
              proveedor: supplierLabel || p.proveedor,
            });
          }
        });
        if (targetUpdates.size === 0) { toast.error(t('import_no_targets_detected')); return; }
        const count = await updateTargetStock(targetUpdates);
        // Log the Target-Stock import as a first-class history event so it shows
        // up in Import History (with the real product count + "Target" type).
        // Best-effort: silently no-ops if migration 009 isn't applied yet.
        await recordTargetImport({
          fileName: `targets_${new Date().toISOString().slice(0, 10)}`,
          supplierName: supplierLabel,
          timestamp: Date.now(),
          productCount: count,
        }).catch(() => {});
        toast.success(t('import_target_success').replace('{count}', String(count)));
        setPreview(null);
        onImported?.();
        return;

      }

      const fileHash = hashProducts(products);
      const isDuplicate = await checkFileDuplicate(fileHash);
      if (isDuplicate) { toast.error(t('import_duplicate_snapshot')); setPreview(null); return; }
      const snapshot: InventorySnapshot = {
        id: `snap_${Date.now()}`, date: new Date(), timestamp: Date.now(),
        fileName: `import_${new Date().toISOString().slice(0, 10)}`, supplierName: supplierLabel, fileHash, products,
      };
      const result = await addSnapshot(snapshot, fileHash);

      const targetUpdates = new Map<string, { stockObjetivo: number; piezas: number; descripcion?: string; proveedor?: string }>();
      products.forEach((p) => {
        if (p.stockObjetivo != null || p.piezas != null) {
          targetUpdates.set(p.clave, {
            stockObjetivo: p.stockObjetivo ?? 0,
            piezas: p.piezas ?? 1,
            descripcion: p.descripcion,
            proveedor: supplierLabel || p.proveedor,
          });
        }
      });
      if (targetUpdates.size > 0) await updateTargetStock(targetUpdates);

      const parts: string[] = [];
      if (result.newProducts > 0) parts.push(`${result.newProducts} ${t('import_new')}`);
      if (result.updatedProducts > 0) parts.push(`${result.updatedProducts} ${t('import_updated')}`);
      if (result.unchangedProducts > 0) parts.push(`${result.unchangedProducts} ${t('import_unchanged')}`);
      toast.success(`✅ ${parts.join(' · ')}`);
      if (targetUpdates.size > 0) {
        toast.success(t('import_target_success').replace('{count}', String(targetUpdates.size)));
      }
      setPreview(null);
      onImported?.();
    } catch (e: any) { toast.error(e.message || t('import_failed')); }
    finally { setIsImporting(false); }
  }, [preview, checkFileDuplicate, addSnapshot, updateTargetStock, addSupplierByName, onImported, t]);

  return (
    <>
      {children(open)}
      <input ref={importInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ''; }} />
      {preview && (
        <GuidedImportModal
          preview={preview}
          supplierName={pendingSupplier}
          isImporting={isImporting}
          onConfirm={handleConfirmImport}
          onCancel={() => setPreview(null)}
        />
      )}
    </>
  );
}
