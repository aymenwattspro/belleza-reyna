'use client';

import React, { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import {
  ArrowLeft,
  Upload,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  Activity,
  Ghost,
  Search,
  FileText,
  FileSpreadsheet,
  CheckCircle2,
  Database,
  Trash2,
  Star
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useInventory, PopularityScore } from '@/contexts/InventoryContext';
import { parseInventoryCSV, parseConfigFile, mergeWithConfig } from '@/lib/utils/timeline-parsers';
import { generateFileHash } from '@/lib/utils/file-hash';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function BehaviorPage() {
  const { snapshots, popularityScores, addSnapshot, deleteSnapshot, refreshData, clearAllData, loading, getProductHistory, checkFileDuplicate } = useInventory();
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const [configFile, setConfigFile] = useState<File | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [deleteConfirmSnapshot, setDeleteConfirmSnapshot] = useState<string | null>(null);

  // Handle file drag events
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processFiles(files);
  }, []);

  const processFiles = (files: File[]) => {
    for (const file of files) {
      const ext = file.name.toLowerCase();
      if (ext.endsWith('.csv') && !inventoryFile) {
        setInventoryFile(file);
        toast.success(`CSV: ${file.name}`);
      } else if ((ext.endsWith('.xlsx') || ext.endsWith('.xls')) && !configFile) {
        setConfigFile(file);
        toast.success(`Excel: ${file.name}`);
      }
    }
  };

  const handleDeleteSnapshot = async (snapshotId: string, fileName: string) => {
    try {
      await deleteSnapshot(snapshotId);
      toast.success(`🗑️ Snapshot "${fileName}" eliminado correctamente`);
      setDeleteConfirmSnapshot(null);
    } catch (error) {
      toast.error(`Error al eliminar snapshot: ${error instanceof Error ? error.message : 'Desconocido'}`);
    }
  };

  const processUpload = async () => {
    if (!inventoryFile) {
      toast.error('Selecciona el CSV de inventario');
      return;
    }

    setIsProcessing(true);
    const toastId = toast.loading('Procesando snapshot...');

    try {
      // Generate file hash to detect duplicates
      const fileHash = await generateFileHash(inventoryFile);

      // Refresh data to ensure we have the latest snapshots
      await refreshData();
      
      // Check if this file has already been imported
      if (await checkFileDuplicate(fileHash)) {
        toast.error('⚠️ Este archivo ya ha sido importado anteriormente. Para mantener la integridad del análisis de comportamiento, cada archivo debe ser único.', { 
          id: toastId,
          duration: 5000 
        });
        setIsProcessing(false);
        return;
      }

      const csvText = await inventoryFile.text();
      const inventory = parseInventoryCSV(csvText);

      let finalInventory = inventory;
      if (configFile) {
        const buffer = await configFile.arrayBuffer();
        const config = parseConfigFile(buffer, configFile.name);
        finalInventory = mergeWithConfig(inventory, config);
      }

      // Create snapshot with file hash
      const snapshot = {
        id: `snap_${Date.now()}`,
        timestamp: Date.now(),
        date: new Date(),
        fileName: inventoryFile.name,
        supplierName: finalInventory[0]?.proveedor || 'General',
        fileHash,
        products: finalInventory.map(p => ({ ...p, existencia: Math.max(0, p.existencia) }))
      };

      await addSnapshot(snapshot, fileHash);

      toast.success(`${inventory.length} productos importados`, { id: toastId });
      setInventoryFile(null);
      setConfigFile(null);
    } catch (error) {
      toast.error(`Error: ${error instanceof Error ? error.message : 'Desconocido'}`, { id: toastId });
    } finally {
      setIsProcessing(false);
    }
  };

  // Filter scores
  const filteredScores = useMemo(() => {
    return popularityScores.filter(s =>
      s.clave.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.descripcion.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [popularityScores, searchTerm]);

  // Movement label helper
  const getMovementLabel = (score: PopularityScore) => {
    if (score.overallScore >= 70) return { label: 'Quick Sale', icon: Zap, color: 'emerald', bg: 'bg-emerald-100', text: 'text-emerald-700' };
    if (score.overallScore >= 30) return { label: 'Stable', icon: Activity, color: 'blue', bg: 'bg-blue-100', text: 'text-blue-700' };
    return { label: 'Slow Sale', icon: Ghost, color: 'gray', bg: 'bg-gray-100', text: 'text-gray-600' };
  };

  // Chart data for selected product
  const chartData = useMemo(() => {
    if (!selectedProduct) return [];
    const history = getProductHistory(selectedProduct);
    return history.map((h, i) => ({
      date: format(h.date, 'dd/MM', { locale: es }),
      existencia: h.existencia,
      sales: i > 0 ? Math.max(0, history[i - 1].existencia - h.existencia) : 0
    }));
  }, [selectedProduct, getProductHistory]);

  const selectedScore = selectedProduct ? popularityScores.find(s => s.clave === selectedProduct) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-gray-200/50 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/inventory-hub" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft size={20} className="text-gray-600" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Product Behavior
                </h1>
                <p className="text-sm text-gray-500">
                  {snapshots.length} snapshots • {popularityScores.length} productos
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowClearConfirm(true)}
                className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                title="Limpiar todos los datos"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Upload Zone */}
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Importar Nuevo Snapshot</h2>

          <div
            className={cn(
              "border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer",
              isDragging 
                ? "border-blue-500 bg-gradient-to-br from-blue-50 to-blue-100 shadow-lg transform scale-[1.02]" 
                : "border-gray-300 hover:border-gray-400 bg-gradient-to-br from-gray-50 to-white hover:shadow-md"
            )}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <div className="relative">
              <Database size={48} className={cn(
                "mx-auto mb-4 transition-colors",
                isDragging ? "text-blue-500" : "text-gray-400"
              )} />
              {isDragging && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 bg-blue-500/20 rounded-full animate-ping" />
                </div>
              )}
            </div>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              {isDragging ? 'Suelta los archivos aquí' : 'Arrastra archivos aquí o haz clic'}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              CSV de inventario (obligatorio) • Excel de configuración (opcional)
            </p>
            <input
              id="file-input"
              type="file"
              accept=".csv,.xlsx,.xls"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* File Status */}
          <div className="mt-4 flex items-center justify-between">
            {inventoryFile ? (
              <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded-lg border border-blue-200">
                <CheckCircle2 size={14} />
                <FileText size={14} />
                <span className="font-medium">{inventoryFile.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-400 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                <FileText size={14} />
                <span>obtener.csv</span>
              </div>
            )}

            {configFile ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200">
                <CheckCircle2 size={14} />
                <FileSpreadsheet size={14} />
                <span className="font-medium truncate max-w-xs">{configFile.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-400 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                <FileSpreadsheet size={14} />
                <span>config.xlsx (opcional)</span>
              </div>
            )}

            {inventoryFile && (
              <button
                onClick={processUpload}
                disabled={isProcessing}
                className="ml-auto px-6 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg text-sm font-medium hover:from-blue-700 hover:to-blue-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform hover:scale-105"
              >
                {isProcessing ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Procesando...
                  </span>
                ) : (
                  'Importar'
                )}
              </button>
            )}
          </div>
        </div>

        {snapshots.length < 2 ? (
          <div className="text-center py-16">
            <Database size={64} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-600 mb-2">Se necesitan más datos</h3>
            <p className="text-gray-500">Importa al menos 2 snapshots para analizar comportamiento.</p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Product List */}
            <div className="lg:col-span-2 space-y-4">
              {/* Search */}
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar producto..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 focus:border-blue-500 outline-none"
                />
              </div>

              {/* Scores Table */}
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-700">Popularity Scores</h3>
                </div>
                <div className="max-h-[500px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Producto</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Tipo</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Score</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Ventas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredScores.map((score) => {
                        const movement = getMovementLabel(score);
                        const Icon = movement.icon;

                        return (
                          <tr
                            key={score.clave}
                            onClick={() => setSelectedProduct(score.clave)}
                            className={cn(
                              "cursor-pointer hover:bg-gray-50 transition-colors",
                              selectedProduct === score.clave && "bg-blue-50"
                            )}
                          >
                            <td className="px-4 py-3">
                              <p className="text-sm font-medium text-gray-800">{score.clave}</p>
                              <p className="text-xs text-gray-500 truncate max-w-xs">{score.descripcion}</p>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium", movement.bg, movement.text)}>
                                <Icon size={12} />
                                {movement.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Star size={14} className="text-yellow-500 fill-yellow-500" />
                                <span className="font-bold text-gray-800">{score.overallScore.toFixed(0)}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-gray-600">
                              {score.totalSales}
                              <span className="text-xs text-gray-400 ml-1">({score.salesVelocity.toFixed(1)}/sem)</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Detail Panel */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              {selectedScore ? (
                <div>
                  <h3 className="font-bold text-gray-800 mb-1">{selectedScore.descripcion}</h3>
                  <p className="text-sm text-gray-500 mb-4">{selectedScore.clave}</p>

                  {/* Score Badge */}
                  <div className="flex items-center gap-2 mb-6">
                    <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full"
                        style={{ width: `${selectedScore.overallScore}%` }}
                      />
                    </div>
                    <span className="text-2xl font-bold text-gray-800">{selectedScore.overallScore.toFixed(0)}</span>
                  </div>

                  {/* Chart */}
                  <div className="h-48 mb-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="existencia" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <p className="text-gray-500 text-xs">Ventas Totales</p>
                      <p className="font-bold text-gray-800">{selectedScore.totalSales}</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <p className="text-gray-500 text-xs">Velocidad</p>
                      <p className="font-bold text-gray-800">{selectedScore.salesVelocity.toFixed(1)}/sem</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <p className="text-gray-500 text-xs">Consistencia</p>
                      <p className="font-bold text-gray-800">{selectedScore.consistencyScore.toFixed(0)}%</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <p className="text-gray-500 text-xs">Tendencia</p>
                      <p className={cn(
                        "font-bold",
                        selectedScore.trend === 'rising' ? "text-emerald-600" :
                        selectedScore.trend === 'falling' ? "text-red-500" : "text-gray-600"
                      )}>
                        {selectedScore.trend === 'rising' ? '↑ Subiendo' :
                         selectedScore.trend === 'falling' ? '↓ Bajando' : '→ Estable'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-400">
                  <TrendingUp size={48} className="mx-auto mb-4" />
                  <p>Selecciona un producto para ver detalles</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Delete Snapshot Confirmation */}
      {deleteConfirmSnapshot && (() => {
        const snapshot = snapshots.find(s => s.id === deleteConfirmSnapshot);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full">
              <h3 className="text-lg font-bold text-gray-800 mb-2">¿Eliminar Snapshot?</h3>
              <p className="text-gray-500 mb-2">
                ¿Estás seguro de que quieres eliminar el snapshot:
              </p>
              <div className="bg-gray-50 p-3 rounded-lg mb-4">
                <p className="font-medium text-gray-800">{snapshot?.fileName}</p>
                <p className="text-sm text-gray-500">
                  {snapshot && format(snapshot.date, 'PPp', { locale: es })}
                </p>
              </div>
              <p className="text-sm text-amber-600 mb-4">
                ⚠️ Esta acción afectará el análisis de comportamiento de los productos
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirmSnapshot(null)}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteSnapshot(deleteConfirmSnapshot, snapshot?.fileName || '')}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Clear All Confirmation */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-gray-800 mb-2">¿Eliminar todos los datos?</h3>
            <p className="text-gray-500 mb-4">Esta acción eliminará todos los snapshots permanentemente.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={() => { clearAllData(); setShowClearConfirm(false); }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
