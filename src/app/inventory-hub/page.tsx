'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, Search, Package, TrendingUp, Trash2, ChevronDown, ChevronUp,
  CheckCircle, AlertCircle, X, Target, RefreshCw,
  Clock, Calendar, AlertTriangle, FileSpreadsheet, ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { format as dateFnsFormat } from 'date-fns';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useInventory } from '@/contexts/InventoryContext';
import { useProductSettings } from '@/contexts/ProductSettingsContext';
import { useOrder } from '@/contexts/OrderContext';
import { getStockStatus, getStatusClasses } from '@/lib/utils/adjust-order';
import {
  parseCSVToPreview, parseExcelToPreview, applyMappingToRows,
  hashProducts,
  ParsePreview, ColMapping,
} from '@/lib/utils/timeline-parsers';
import { InventorySnapshot } from '@/lib/types/inventory-timeline';

// ============================================================
// Column key options for guided import
// Only Reference (claveIdx) and Description (descIdx) are required.
// Supplier column removed — supplier name is set at the top of the modal.
// ============================================================
interface ColField {
  key: keyof ColMapping;
  label: string;
  required?: boolean;
}
const COL_FIELDS: ColField[] = [
  { key: 'claveIdx',         label: 'Reference / SKU',   required: true },
  { key: 'descIdx',          label: 'Description',        required: true },
  { key: 'existenciaIdx',    label: 'Stock / Existencia' },
  { key: 'precioCIdx',       label: 'Cost Price' },
  { key: 'precioVIdx',       label: 'Sale Price' },
  { key: 'stockObjetivoIdx', label: 'Target Stock' },
  { key: 'piezasIdx',        label: 'Units per Case' },
];

// ============================================================
// Guided Import Modal
// ============================================================
interface GuidedImportProps {
  preview: ParsePreview;
  supplierName: string;
  onSupplierChange: (s: string) => void;
  onConfirm: (mapping: ColMapping, supplier: string) => void;
  onCancel: () => void;
  importType: 'inventory' | 'targetstock';
}

function GuidedImportModal({
  preview, supplierName, onSupplierChange, onConfirm, onCancel, importType,
}: GuidedImportProps) {
  const [mapping, setMapping] = useState<ColMapping>({ ...preview.mapping });
  const [localSupplier, setLocalSupplier] = useState(supplierName);
  const [customSupplier, setCustomSupplier] = useState('');

  const setField = (field: keyof ColMapping, value: number) => {
    setMapping((prev) => ({ ...prev, [field]: value }));
  };

  const estimatedCount = useMemo(() => {
    try {
      const products = applyMappingToRows(preview.rawRows, mapping, localSupplier || 'General');
      return products.length;
    } catch {
      return 0;
    }
  }, [preview.rawRows, mapping, localSupplier]);

  const effectiveSupplier = customSupplier || localSupplier;

  // Only show non-empty header options in dropdowns
  const nonEmptyHeaders = preview.allHeaders
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h && h.trim() !== '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {importType === 'targetstock' ? '🎯 Import Target Stock' : '📦 Import Inventory Snapshot'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Verify column mapping before importing · ~{estimatedCount} products detected
            </p>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Supplier */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Supplier Name
            </label>
            <div className="flex gap-2">
              <select
                value={localSupplier}
                onChange={(e) => { setLocalSupplier(e.target.value); setCustomSupplier(''); }}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-pink-400"
              >
                <option value="General">General</option>
                <option value="Pink Up">Pink Up</option>
                <option value="Beauty Creations">Beauty Creations</option>
                <option value="Bissu">Bissu</option>
                <option value="Prosa">Prosa</option>
                <option value="Vogue">Vogue</option>
                <option value="Maybelline">Maybelline</option>
                <option value="L'Oreal">L'Oreal</option>
                <option value="NYX">NYX</option>
                <option value="__custom__">+ Add new supplier...</option>
              </select>
              {localSupplier === '__custom__' && (
                <input
                  value={customSupplier}
                  onChange={(e) => setCustomSupplier(e.target.value)}
                  placeholder="Type supplier name"
                  className="flex-1 px-3 py-2 rounded-lg border border-pink-200 text-sm outline-none focus:border-pink-400"
                />
              )}
            </div>
          </div>

          {/* Column Mapping */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Column Mapping
            </label>
            <p className="text-xs text-gray-400 mb-3">
              Detected headers: {preview.allHeaders.filter(Boolean).join(', ')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {COL_FIELDS.map(({ key, label, required }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-1">
                    {label}
                    {required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <select
                    value={(mapping as any)[key]}
                    onChange={(e) => setField(key as keyof ColMapping, parseInt(e.target.value))}
                    className={cn(
                      'w-full px-2 py-1.5 rounded-lg border text-xs outline-none',
                      required && (mapping as any)[key] === -1
                        ? 'border-red-300 bg-red-50'
                        : 'border-gray-200 focus:border-pink-400'
                    )}
                  >
                    <option value={-1}>— Not mapped —</option>
                    {/* Only show columns that have an actual header (no empty columns) */}
                    {nonEmptyHeaders.map(({ h, i }) => (
                      <option key={i} value={i}>
                        Col {i + 1}: {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview Table */}
          {preview.sampleRows.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Data Preview (first 5 rows)
              </label>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="text-xs w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Ref/SKU</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Description</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-600">Stock</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-600">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-gray-700">
                          {mapping.claveIdx >= 0 ? (row[mapping.claveIdx] || '—') : '—'}
                        </td>
                        <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate">
                          {mapping.descIdx >= 0 ? (row[mapping.descIdx] || '—') : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-gray-700">
                          {mapping.existenciaIdx >= 0 ? (row[mapping.existenciaIdx] || '0') : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {mapping.precioCIdx >= 0 ? (row[mapping.precioCIdx] || '—') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Product count banner */}
          <div className={cn(
            'rounded-xl p-4 flex items-center gap-3',
            estimatedCount > 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'
          )}>
            {estimatedCount > 0
              ? <CheckCircle size={18} className="text-emerald-600 shrink-0" />
              : <AlertCircle size={18} className="text-amber-600 shrink-0" />}
            <div>
              <p className={cn('text-sm font-semibold', estimatedCount > 0 ? 'text-emerald-700' : 'text-amber-700')}>
                {estimatedCount > 0
                  ? `${estimatedCount} products ready to import`
                  : 'No products detected — check your column mapping above'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">File contains ~{preview.totalRows} data rows total</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(mapping, effectiveSupplier)}
            disabled={estimatedCount === 0}
            className="px-5 py-2 bg-pink-500 text-white text-sm font-semibold rounded-xl hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Import {estimatedCount} Products
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main Home Page
// ============================================================
export default function InventoryHubPage() {
  const router = useRouter();
  const { snapshots, latestSnapshot, loading, addSnapshot, deleteSnapshot, checkFileDuplicate, updateTargetStock, clearAllData } = useInventory();
  const { getAll: getAllSettings } = useProductSettings();
  const { buildOrderFromSnapshot } = useOrder();

  // ─── Import State ────────────────────────────────────────────
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [importType, setImportType] = useState<'inventory' | 'targetstock'>('inventory');
  const [pendingSupplier, setPendingSupplier] = useState('General');
  const [isImporting, setIsImporting] = useState(false);
  const inventoryInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);

  // ─── Search state ────────────────────────────────────────────
  const [inventorySearch, setInventorySearch] = useState('');
  const [behaviorSearch, setBehaviorSearch] = useState('');

  // ─── Stock status filter for right panel ─────────────────────
  const [stockFilter, setStockFilter] = useState<'all' | 'green' | 'orange' | 'red' | 'pending'>('all');

  // ─── Expanded snapshot in behavior panel ────────────────────
  const [expandedSnap, setExpandedSnap] = useState<string | null>(null);

  // ─── Build settings map for order context ───────────────────
  const settingsMap = useMemo(() => {
    const all = getAllSettings();
    const map = new Map<string, { minStockUnits: number; piezas?: number }>();
    for (const s of all) map.set(s.clave, { minStockUnits: s.minStockUnits, piezas: s.minStockCases });
    return map;
  }, [getAllSettings]);

  // Rebuild order whenever snapshot or settings change
  // When latestSnapshot becomes null (data cleared/all deleted), clear the order lines too
  useEffect(() => {
    if (latestSnapshot) {
      buildOrderFromSnapshot(latestSnapshot.products, settingsMap, latestSnapshot.id);
    } else if (!loading) {
      buildOrderFromSnapshot([], settingsMap);
    }
  }, [latestSnapshot, settingsMap, loading, buildOrderFromSnapshot]);

  // ─── Current inventory products with status ──────────────────
  const inventoryProducts = useMemo(() => {
    if (!latestSnapshot) return [];
    const all = getAllSettings();
    const settingsLookup = new Map(all.map((s) => [s.clave, s]));

    return latestSnapshot.products.map((p) => {
      const s = settingsLookup.get(p.clave);
      const effectiveMin = s?.minStockUnits || p.stockObjetivo || 0;
      const stock = Math.max(0, p.existencia);
      const status = getStockStatus(stock, effectiveMin);
      return { ...p, effectiveMin, stock, status };
    });
  }, [latestSnapshot, getAllSettings]);

  const filteredInventory = useMemo(() => {
    let products = inventoryProducts;

    // Stock status filter
    if (stockFilter === 'pending') {
      // Products with no target stock set
      products = products.filter((p) => (p.stockObjetivo == null || p.stockObjetivo <= 0));
    } else if (stockFilter !== 'all') {
      products = products.filter((p) => p.status === stockFilter);
    }

    // Text search
    if (inventorySearch.trim()) {
      const q = inventorySearch.toLowerCase();
      products = products.filter(
        (p) =>
          p.clave.toLowerCase().includes(q) ||
          p.descripcion.toLowerCase().includes(q) ||
          (p.proveedor || '').toLowerCase().includes(q)
      );
    }

    return products;
  }, [inventoryProducts, inventorySearch, stockFilter]);

  // Stock statistics for the filter buttons
  const stockStats = useMemo(() => {
    const green = inventoryProducts.filter((p) => p.status === 'green').length;
    const orange = inventoryProducts.filter((p) => p.status === 'orange').length;
    const red = inventoryProducts.filter((p) => p.status === 'red').length;
    const pending = inventoryProducts.filter((p) => (p.stockObjetivo == null || p.stockObjetivo <= 0)).length;
    return { green, orange, red, pending, total: inventoryProducts.length };
  }, [inventoryProducts]);

  // ─── Export pending targets to Excel ──────────────────────────
  const exportPendingTargets = useCallback(() => {
    const pending = inventoryProducts.filter((p) => (p.stockObjetivo == null || p.stockObjetivo <= 0));
    const rows = pending.map((p) => ({
      Reference: p.clave,
      Description: p.descripcion,
      Supplier: p.proveedor || '',
      'Current Stock': p.stock,
      'Cost Price': p.precioC || '',
      'Target Stock': '',
      'Units per Case': p.piezas || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pending Targets');
    XLSX.writeFile(wb, `pending-targets-${dateFnsFormat(new Date(), 'yyyy-MM-dd')}.xlsx`);
  }, [inventoryProducts]);

  // ─── Behavior products (need ≥ 2 snapshots) ──────────────────
  const behaviorProducts = useMemo(() => {
    if (snapshots.length < 2 || !latestSnapshot) return [];
    const claves = new Set<string>();
    for (const s of snapshots) for (const p of s.products) claves.add(p.clave);

    const result: { clave: string; descripcion: string; proveedor: string; latestStock: number; pointCount: number }[] = [];
    for (const clave of claves) {
      const history = snapshots
        .map((s) => s.products.find((p) => p.clave === clave))
        .filter(Boolean);
      if (history.length < 2) continue;
      const latest = latestSnapshot.products.find((p) => p.clave === clave);
      if (!latest) continue;
      result.push({
        clave,
        descripcion: latest.descripcion,
        proveedor: latest.proveedor || 'General',
        latestStock: Math.max(0, latest.existencia),
        pointCount: history.length,
      });
    }
    return result.sort((a, b) => a.descripcion.localeCompare(b.descripcion));
  }, [snapshots, latestSnapshot]);

  const filteredBehavior = useMemo(() => {
    if (!behaviorSearch.trim()) return behaviorProducts;
    const q = behaviorSearch.toLowerCase();
    return behaviorProducts.filter(
      (p) =>
        p.clave.toLowerCase().includes(q) ||
        p.descripcion.toLowerCase().includes(q) ||
        p.proveedor.toLowerCase().includes(q)
    );
  }, [behaviorProducts, behaviorSearch]);

  // ─── File handlers ────────────────────────────────────────────
  const handleFileSelect = useCallback(
    async (file: File, type: 'inventory' | 'targetstock') => {
      setImportType(type);
      try {
        let prev: ParsePreview;
        if (file.name.endsWith('.csv')) {
          const text = await file.text();
          prev = parseCSVToPreview(text, file.name);
        } else {
          const buf = await file.arrayBuffer();
          prev = parseExcelToPreview(buf, file.name);
        }
        setPendingSupplier(prev.detectedSupplier);
        setPreview(prev);
      } catch (e: any) {
        toast.error(e.message || 'Failed to read file');
      }
    },
    []
  );

  const handleConfirmImport = useCallback(
    async (mapping: ColMapping, supplier: string) => {
      if (!preview) return;
      setIsImporting(true);
      try {
        const products = applyMappingToRows(preview.rawRows, mapping, supplier);
        if (products.length === 0) {
          toast.error('No valid products found with current mapping.');
          return;
        }

        // Duplicate-file guard (async — DB handles per-product smart merge)
        const fileHash = hashProducts(products);
        const isDuplicate = await checkFileDuplicate(fileHash);
        if (isDuplicate) {
          toast.error('This exact inventory snapshot was already imported. No changes made.');
          setPreview(null);
          return;
        }

        const snapshot: InventorySnapshot = {
          id: `snap_${Date.now()}`,
          date: new Date(),
          timestamp: Date.now(),
          fileName: `import_${new Date().toISOString().slice(0, 10)}`,
          supplierName: supplier,
          fileHash,
          products, // Only products from this file — DB smart-merge handles preservation
        };

        const result = await addSnapshot(snapshot, fileHash);
        const parts: string[] = [];
        if (result.newProducts > 0) parts.push(`${result.newProducts} new`);
        if (result.updatedProducts > 0) parts.push(`${result.updatedProducts} updated`);
        if (result.unchangedProducts > 0) parts.push(`${result.unchangedProducts} unchanged`);
        toast.success(`✅ ${parts.join(' · ')}`);
        setPreview(null);
      } catch (e: any) {
        toast.error(e.message || 'Import failed');
      } finally {
        setIsImporting(false);
      }
    },
    [preview, checkFileDuplicate, addSnapshot]
  );

  const handleTargetStockImport = useCallback(
    async (mapping: ColMapping, supplier: string) => {
      if (!preview || !latestSnapshot) return;
      setIsImporting(true);
      try {
        const configProducts = applyMappingToRows(preview.rawRows, mapping, supplier);
        const updates = new Map(
          configProducts
            .filter(p => p.stockObjetivo != null || p.piezas != null)
            .map(p => [
              p.clave,
              { stockObjetivo: p.stockObjetivo ?? p.existencia, piezas: p.piezas ?? 1 },
            ])
        );

        const count = await updateTargetStock(updates);
        toast.success(`🎯 Target stock updated for ${count} products`);
        setPreview(null);
      } catch (e: any) {
        toast.error(e.message || 'Target stock import failed');
      } finally {
        setIsImporting(false);
      }
    },
    [preview, latestSnapshot, updateTargetStock]
  );

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Guided Import Modal */}
      {preview && (
        <GuidedImportModal
          preview={preview}
          supplierName={pendingSupplier}
          onSupplierChange={setPendingSupplier}
          onConfirm={importType === 'targetstock' ? handleTargetStockImport : handleConfirmImport}
          onCancel={() => setPreview(null)}
          importType={importType}
        />
      )}

      {/* Page Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Inventory Hub</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {latestSnapshot
                ? `Last import: ${format(latestSnapshot.date, 'dd MMM yyyy · HH:mm')} · ${latestSnapshot.products.length} products`
                : 'No data imported yet'}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            {latestSnapshot && (
              <>
                <button
                  onClick={() => {
                    if (window.confirm('⚠️ This will delete ALL inventory data (all imports, stock history). This cannot be undone.\n\nAfter resetting, re-import your files from scratch.')) {
                      clearAllData().then(() => toast.success('All inventory data cleared. Import fresh files to start.'));
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-gray-400 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 text-xs font-medium rounded-xl transition-colors"
                  title="Reset all data — use this if your product count seems wrong"
                >
                  <Trash2 size={13} />
                  Reset Data
                </button>
                <button
                  onClick={() => targetInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 text-sm font-medium rounded-xl hover:bg-indigo-100 transition-colors"
                >
                  <Target size={14} />
                  Import Target Stock
                </button>
              </>
            )}
            <button
              onClick={() => inventoryInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-pink-500 text-white text-sm font-semibold rounded-xl hover:bg-pink-600 transition-colors"
            >
              <Upload size={14} />
              Import Inventory
            </button>
          </div>
        </div>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={inventoryInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f, 'inventory'); e.target.value = ''; }}
      />
      <input
        ref={targetInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f, 'targetstock'); e.target.value = ''; }}
      />

      {/* ── Import Timeline ──────────────────────────────────────── */}
      {snapshots.length > 0 && (
        <div className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={13} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Import History
            </span>
            <span className="text-xs text-gray-400">({snapshots.length} files)</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {snapshots.map((snap, idx) => (
              <TimelineChip
                key={snap.id}
                snap={snap}
                isLatest={idx === 0}
                onDelete={deleteSnapshot}
              />
            ))}
          </div>
        </div>
      )}

      {/* Main split layout */}
      <div className="flex flex-1 min-h-0">
        {/* LEFT: Product Behavior */}
        <div className="w-1/2 border-r border-gray-200 flex flex-col bg-white">
          <div className="px-4 py-3 border-b border-gray-100 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                <TrendingUp size={15} className="text-indigo-500" />
                Product Behavior
                <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-normal">
                  {filteredBehavior.length}
                </span>
              </h2>
              <Link
                href="/inventory-hub/behavior"
                className="text-xs text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-1 transition-colors"
              >
                Full Analysis <ExternalLink size={10} />
              </Link>
            </div>
            {/* Search bar */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={behaviorSearch}
                onChange={(e) => setBehaviorSearch(e.target.value)}
                placeholder="Search by ref, name or supplier…"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-indigo-400 bg-gray-50"
              />
              {behaviorSearch && (
                <button onClick={() => setBehaviorSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X size={12} className="text-gray-400" />
                </button>
              )}
            </div>
          </div>

          {/* Behavior product list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw size={18} className="text-gray-400 animate-spin" />
              </div>
            ) : snapshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center p-6">
                <Upload size={32} className="text-gray-300 mb-3" />
                <p className="text-sm font-medium text-gray-500">No imports yet</p>
                <p className="text-xs text-gray-400 mt-1">Upload a CSV or Excel inventory file to get started</p>
                <button
                  onClick={() => inventoryInputRef.current?.click()}
                  className="mt-4 px-4 py-2 bg-pink-500 text-white text-sm font-medium rounded-xl hover:bg-pink-600 transition-colors"
                >
                  Import first file
                </button>
              </div>
            ) : snapshots.length < 2 ? (
              <div className="p-4">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 mb-3">
                  ⚠️ Import at least 2 snapshots to see product behavior trends.
                </div>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                <div className="text-xs text-gray-400 px-1 mb-1">
                  {filteredBehavior.length} products with 2+ data points
                </div>

                {filteredBehavior.map((p) => (
                  <BehaviorProductRow
                    key={p.clave}
                    clave={p.clave}
                    descripcion={p.descripcion}
                    proveedor={p.proveedor}
                    latestStock={p.latestStock}
                    pointCount={p.pointCount}
                    snapshots={snapshots}
                    expanded={expandedSnap === p.clave}
                    onExpand={() => setExpandedSnap(expandedSnap === p.clave ? null : p.clave)}
                    onClick={() => router.push(`/product/${encodeURIComponent(p.clave)}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Current Inventory */}
        <div className="w-1/2 flex flex-col bg-gray-50">
          <div className="px-4 py-3 border-b border-gray-200 bg-white shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                <Package size={15} className="text-pink-500" />
                Current Inventory
                <span className="text-xs bg-pink-50 text-pink-600 px-2 py-0.5 rounded-full font-normal">
                  {filteredInventory.length}
                </span>
              </h2>
            </div>

            {/* Stock status filter buttons */}
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              <button
                onClick={() => setStockFilter('all')}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full font-medium transition-all',
                  stockFilter === 'all'
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                )}
              >
                All {stockStats.total > 0 && <span className="opacity-70">({stockStats.total})</span>}
              </button>
              <button
                onClick={() => setStockFilter('green')}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1',
                  stockFilter === 'green'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
                In Stock ({stockStats.green})
              </button>
              <button
                onClick={() => setStockFilter('orange')}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1',
                  stockFilter === 'orange'
                    ? 'bg-orange-500 text-white'
                    : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
                Low ({stockStats.orange})
              </button>
              <button
                onClick={() => setStockFilter('red')}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1',
                  stockFilter === 'red'
                    ? 'bg-red-600 text-white'
                    : 'bg-red-50 text-red-700 hover:bg-red-100'
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
                Out ({stockStats.red})
              </button>
              {/* Pending Targets — products missing a target stock value */}
              {stockStats.pending > 0 && (
                <button
                  onClick={() => setStockFilter('pending')}
                  className={cn(
                    'text-xs px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1',
                    stockFilter === 'pending'
                      ? 'bg-amber-500 text-white'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                  )}
                >
                  <AlertTriangle size={9} className="inline-block" />
                  Pending Targets ({stockStats.pending})
                </button>
              )}
              {/* Export button — only visible in Pending Targets view */}
              {stockFilter === 'pending' && (
                <button
                  onClick={exportPendingTargets}
                  className="ml-auto text-xs px-2.5 py-1 rounded-full font-medium bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 transition-all flex items-center gap-1"
                >
                  <FileSpreadsheet size={10} className="inline-block" />
                  Export .xlsx
                </button>
              )}
            </div>

            {/* Search bar */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                placeholder="Search by ref, name or supplier…"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-pink-400 bg-gray-50"
              />
              {inventorySearch && (
                <button onClick={() => setInventorySearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X size={12} className="text-gray-400" />
                </button>
              )}
            </div>
          </div>

          {/* Inventory table */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw size={18} className="text-gray-400 animate-spin" />
              </div>
            ) : !latestSnapshot ? (
              <div className="flex flex-col items-center justify-center h-48 text-center p-6">
                <Package size={32} className="text-gray-300 mb-3" />
                <p className="text-sm font-medium text-gray-500">No inventory data</p>
                <p className="text-xs text-gray-400 mt-1">Import a snapshot to see your current stock here</p>
              </div>
            ) : filteredInventory.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 p-4">
                <Search size={24} className="text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No products match your search</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-white border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">Product</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wider w-16">Stock</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wider w-16">Target</th>
                    <th className="px-3 py-2 text-center font-semibold text-gray-500 uppercase tracking-wider w-16">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {filteredInventory.map((p) => {
                    const sc = getStatusClasses(p.status);
                    return (
                      <tr
                        key={p.clave}
                        onClick={() => router.push(`/product/${encodeURIComponent(p.clave)}`)}
                        className="hover:bg-gray-50 transition-colors cursor-pointer group"
                      >
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-800 truncate max-w-[200px] group-hover:text-pink-600 transition-colors">
                            {p.descripcion}
                          </p>
                          <p className="text-[10px] text-gray-400 font-mono">{p.clave} · {p.proveedor || '—'}</p>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={cn('font-bold tabular-nums', sc.text)}>{p.stock}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="text-gray-500 tabular-nums">
                            {p.effectiveMin > 0 ? p.effectiveMin : '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={cn('inline-flex items-center justify-center w-5 h-5 rounded-full', sc.badge)}>
                            <span className={cn('w-2 h-2 rounded-full', sc.dot)} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Timeline Chip — compact import history card
// ============================================================
function TimelineChip({
  snap,
  isLatest,
  onDelete,
}: {
  snap: InventorySnapshot;
  isLatest: boolean;
  onDelete: (id: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs shrink-0 group transition-all',
      isLatest
        ? 'bg-pink-50 border-pink-200 text-pink-700'
        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
    )}>
      <Calendar size={11} className="shrink-0 opacity-60" />
      <span className="font-medium whitespace-nowrap">
        {snap.supplierName || 'Unknown'}
      </span>
      <span className="opacity-60 whitespace-nowrap">
        {format(snap.date, 'dd MMM')}
      </span>
      <span className="opacity-50">·</span>
      <span className="opacity-60">{snap.products.length}p</span>

      {confirming ? (
        <div className="flex items-center gap-1 ml-1">
          <button
            onClick={() => onDelete(snap.id)}
            className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-medium hover:bg-red-600"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="text-[10px] text-gray-400 hover:text-gray-600 px-1"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="opacity-0 group-hover:opacity-100 ml-1 p-0.5 hover:bg-red-100 rounded-full transition-all"
          title="Delete this import"
        >
          <Trash2 size={10} className="text-red-400" />
        </button>
      )}
    </div>
  );
}

// ============================================================
// Behavior Product Row with mini chart
// ============================================================
function BehaviorProductRow({
  clave, descripcion, proveedor, latestStock, pointCount,
  snapshots, expanded, onExpand, onClick,
}: {
  clave: string;
  descripcion: string;
  proveedor: string;
  latestStock: number;
  pointCount: number;
  snapshots: InventorySnapshot[];
  expanded: boolean;
  onExpand: () => void;
  onClick: () => void;
}) {
  const chartData = useMemo(() => {
    return snapshots
      .map((s) => {
        const p = s.products.find((pr) => pr.clave === clave);
        return p ? { date: format(s.date, 'dd/MM'), stock: Math.max(0, p.existencia) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        const [ad, am] = (a!.date).split('/');
        const [bd, bm] = (b!.date).split('/');
        return parseInt(am + ad) - parseInt(bm + bd);
      }) as { date: string; stock: number }[];
  }, [clave, snapshots]);

  const trend = useMemo(() => {
    if (chartData.length < 2) return 'stable';
    const last = chartData[chartData.length - 1].stock;
    const prev = chartData[chartData.length - 2].stock;
    if (last < prev * 0.9) return 'falling';
    if (last > prev * 1.1) return 'rising';
    return 'stable';
  }, [chartData]);

  return (
    <div className="rounded-xl border border-gray-100 overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer"
        onClick={onExpand}
      >
        <div className="flex-1 min-w-0" onClick={(e) => { e.stopPropagation(); onClick(); }}>
          <p className="text-xs font-medium text-gray-800 truncate hover:text-indigo-600 transition-colors">
            {descripcion}
          </p>
          <p className="text-[10px] text-gray-400 font-mono">{clave} · {proveedor}</p>
        </div>
        <span className={cn(
          'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
          trend === 'falling' ? 'bg-red-50 text-red-500' :
          trend === 'rising' ? 'bg-emerald-50 text-emerald-600' :
          'bg-gray-100 text-gray-500'
        )}>
          {trend === 'falling' ? '↓' : trend === 'rising' ? '↑' : '→'} {latestStock}
        </span>
        <span className="text-[10px] text-gray-400">{pointCount}pts</span>
        {expanded ? <ChevronUp size={12} className="text-gray-400 shrink-0" /> : <ChevronDown size={12} className="text-gray-400 shrink-0" />}
      </div>

      {expanded && chartData.length >= 2 && (
        <div className="h-28 px-2 pb-2 bg-gray-50">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={{ fontSize: 10, borderRadius: 6 }} />
              <Line type="monotone" dataKey="stock" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
