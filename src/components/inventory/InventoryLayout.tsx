'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Upload, Package, TrendingUp, History, FileText, FileSpreadsheet, CheckCircle2, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { parseInventoryCSV, parseConfigFile, mergeWithConfig } from '@/lib/utils/timeline-parsers';
import { inventoryDB } from '@/lib/db/inventory-db';
import { InventorySnapshot } from '@/lib/types/inventory-timeline';

export type ViewType = 'live' | 'behavior';

interface InventoryLayoutProps {
  children: React.ReactNode;
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
  onDataUpdate: () => void;
  snapshots: InventorySnapshot[];
}

export function InventoryLayout({
  children,
  activeView,
  onViewChange,
  onDataUpdate,
  snapshots
}: InventoryLayoutProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const [configFile, setConfigFile] = useState<File | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
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
      const extension = file.name.toLowerCase();
      if (extension.endsWith('.csv') && !inventoryFile) {
        setInventoryFile(file);
        toast.success(`CSV seleccionado: ${file.name}`);
      } else if ((extension.endsWith('.xlsx') || extension.endsWith('.xls')) && !configFile) {
        setConfigFile(file);
        toast.success(`Excel seleccionado: ${file.name}`);
      }
    }
  };

  const processUpload = async () => {
    if (!inventoryFile) {
      toast.error('Selecciona el archivo CSV de inventario');
      return;
    }

    setIsProcessing(true);
    const toastId = toast.loading('Procesando...');

    try {
      // Parse inventory CSV
      const csvText = await inventoryFile.text();
      const inventory = parseInventoryCSV(csvText);

      if (inventory.length === 0) {
        throw new Error('No se encontraron productos');
      }

      // Parse config if provided
      let finalInventory = inventory;
      if (configFile) {
        const configBuffer = await configFile.arrayBuffer();
        const config = parseConfigFile(configBuffer, configFile.name);
        finalInventory = mergeWithConfig(inventory, config);
      }

      // Create snapshot with timestamp
      const snapshotId = `snap_${Date.now()}`;
      const snapshot = {
        id: snapshotId,
        timestamp: Date.now(),
        date: new Date().toISOString(),
        fileName: inventoryFile.name,
        supplierName: finalInventory[0]?.proveedor || 'General',
        products: finalInventory
      };

      // Save to IndexedDB (append, don't overwrite)
      await inventoryDB.saveSnapshot(snapshot);

      toast.success(`${inventory.length} productos importados`, { id: toastId });

      // Reset and notify
      setInventoryFile(null);
      setConfigFile(null);
      onDataUpdate();

    } catch (error) {
      console.error('Error:', error);
      toast.error(`Error: ${error instanceof Error ? error.message : 'Desconocido'}`, { id: toastId });
    } finally {
      setIsProcessing(false);
    }
  };

  const clearFiles = () => {
    setInventoryFile(null);
    setConfigFile(null);
  };

  // Format snapshot count/date
  const latestSnapshot = snapshots[0];
  const snapshotCount = snapshots.length;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* LEFT SIDEBAR */}
      <aside className="w-80 bg-white border-r border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-reyna-accent flex items-center justify-center">
              <Database size={20} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-800">Inventory Tracker</h1>
              <p className="text-xs text-gray-500">
                {snapshotCount} import{snapshotCount !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        {/* PERSISTENT IMPORT ZONE */}
        <div className="p-4 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Importar Datos
          </p>

          <div
            className={cn(
              "border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer",
              isDragging
                ? "border-reyna-accent bg-reyna-pink"
                : "border-gray-300 hover:border-gray-400",
              (inventoryFile && configFile) && "border-emerald-400 bg-emerald-50"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              multiple
              className="hidden"
              id="sidebar-file-upload"
              onChange={handleFileSelect}
            />
            <label htmlFor="sidebar-file-upload" className="cursor-pointer block">
              <Upload size={20} className="mx-auto mb-2 text-gray-400" />
              <p className="text-xs text-gray-600 font-medium">
                Arrastra o selecciona
              </p>
              <p className="text-[10px] text-gray-400 mt-1">
                CSV inventario + Excel config
              </p>
            </label>
          </div>

          {/* File Status */}
          <div className="mt-3 space-y-1">
            {inventoryFile ? (
              <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-2 py-1.5 rounded-lg text-xs">
                <CheckCircle2 size={12} />
                <FileText size={12} />
                <span className="truncate">{inventoryFile.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-gray-400 px-2 py-1.5 text-xs">
                <FileText size={12} />
                <span>obtener.csv (req)</span>
              </div>
            )}

            {configFile ? (
              <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-2 py-1.5 rounded-lg text-xs">
                <CheckCircle2 size={12} />
                <FileSpreadsheet size={12} />
                <span className="truncate">{configFile.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-gray-400 px-2 py-1.5 text-xs">
                <FileSpreadsheet size={12} />
                <span>config.xlsx (opt)</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          {inventoryFile && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={clearFiles}
                disabled={isProcessing}
                className="flex-1 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Limpiar
              </button>
              <button
                onClick={processUpload}
                disabled={isProcessing}
                className={cn(
                  "flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all",
                  isProcessing
                    ? "bg-gray-200 text-gray-400"
                    : "bg-reyna-accent text-white hover:bg-reyna-accent/90"
                )}
              >
                {isProcessing ? '...' : 'Importar'}
              </button>
            </div>
          )}
        </div>

        {/* NAVIGATION MENU */}
        <nav className="flex-1 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Vistas
          </p>

          <div className="space-y-1">
            <button
              onClick={() => onViewChange('live')}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all",
                activeView === 'live'
                  ? "bg-reyna-accent/10 text-reyna-accent"
                  : "text-gray-600 hover:bg-gray-100"
              )}
            >
              <Package size={18} />
              Live Inventory & Orders
              {latestSnapshot && (
                <span className="ml-auto text-xs bg-white px-2 py-0.5 rounded-full">
                  {latestSnapshot.products.length}
                </span>
              )}
            </button>

            <button
              onClick={() => onViewChange('behavior')}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all",
                activeView === 'behavior'
                  ? "bg-reyna-accent/10 text-reyna-accent"
                  : "text-gray-600 hover:bg-gray-100"
              )}
            >
              <TrendingUp size={18} />
              Product Behavior Analysis
              {snapshotCount > 1 && (
                <span className="ml-auto text-xs bg-white px-2 py-0.5 rounded-full">
                  {snapshotCount} pts
                </span>
              )}
            </button>
          </div>

          {/* Recent Imports */}
          {snapshots.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Importaciones Recientes
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {snapshots.slice(0, 5).map((snap) => (
                  <div
                    key={snap.id}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-xs"
                  >
                    <History size={12} className="text-gray-400" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium text-gray-700">{snap.fileName}</p>
                      <p className="text-gray-400">
                        {new Date(snap.date).toLocaleDateString('es-MX', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                    <span className="text-gray-500">{snap.products.length}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Database size={12} />
            <span>Datos guardados localmente</span>
          </div>
        </div>
      </aside>

      {/* RIGHT MAIN CONTENT */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
