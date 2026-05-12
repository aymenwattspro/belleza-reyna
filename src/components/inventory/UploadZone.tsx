'use client';

import React, { useState, useCallback } from 'react';
import { Upload, FileText, FileSpreadsheet, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { inventoryDB } from '@/lib/db/inventory-db';
import { parseInventoryCSV, parseConfigFile, mergeWithConfig } from '@/lib/utils/timeline-parsers';

interface UploadZoneProps {
  onUploadComplete: () => void;
}

export function UploadZone({ onUploadComplete }: UploadZoneProps) {
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

  const processFiles = async (files: File[]) => {
    for (const file of files) {
      const extension = file.name.toLowerCase();

      if (extension.endsWith('.csv') && !inventoryFile) {
        setInventoryFile(file);
        toast.success(`Archivo de inventario seleccionado: ${file.name}`);
      } else if ((extension.endsWith('.xlsx') || extension.endsWith('.xls') || extension.endsWith('.csv')) && !configFile) {
        setConfigFile(file);
        toast.success(`Archivo de configuración seleccionado: ${file.name}`);
      }
    }
  };

  const processUpload = async () => {
    if (!inventoryFile) {
      toast.error('Por favor selecciona el archivo de inventario CSV');
      return;
    }

    setIsProcessing(true);
    const toastId = toast.loading('Procesando archivos...');

    try {
      // Parse inventory CSV
      const csvText = await inventoryFile.text();
      const inventory = parseInventoryCSV(csvText);

      if (inventory.length === 0) {
        throw new Error('No se encontraron productos en el archivo CSV');
      }

      toast.success(`📦 ${inventory.length} productos encontrados`, { id: toastId });

      // Parse config if provided
      let finalInventory = inventory;
      if (configFile) {
        const configBuffer = await configFile.arrayBuffer();
        const config = parseConfigFile(configBuffer, configFile.name);
        finalInventory = mergeWithConfig(inventory, config);

        const matchedCount = finalInventory.filter(p => p.stockObjetivo !== undefined).length;
        toast.success(`🎯 ${matchedCount} productos con configuración de stock objetivo`);
      }

      // Create snapshot
      const snapshotId = `snap_${Date.now()}`;
      const snapshot = {
        id: snapshotId,
        timestamp: Date.now(),
        date: new Date().toISOString(),
        fileName: inventoryFile.name,
        supplierName: finalInventory[0]?.proveedor || 'General',
        products: finalInventory
      };

      // Save to IndexedDB
      await inventoryDB.saveSnapshot(snapshot);

      toast.success('✅ Snapshot guardado correctamente');

      // Reset and notify
      setInventoryFile(null);
      setConfigFile(null);
      onUploadComplete();

    } catch (error) {
      console.error('Error processing files:', error);
      toast.error(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`, { id: toastId });
    } finally {
      setIsProcessing(false);
    }
  };

  const clearFiles = () => {
    setInventoryFile(null);
    setConfigFile(null);
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className={cn(
          "relative border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300",
          isDragging
            ? "border-reyna-accent bg-reyna-pink"
            : "border-gray-300 hover:border-gray-400 bg-white",
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
          id="file-upload"
          onChange={handleFileSelect}
        />

        <label
          htmlFor="file-upload"
          className="cursor-pointer flex flex-col items-center gap-4"
        >
          <div className={cn(
            "w-16 h-16 rounded-full flex items-center justify-center transition-colors",
            isDragging ? "bg-reyna-accent text-white" : "bg-gray-100 text-gray-400"
          )}>
            <Upload size={28} />
          </div>

          <div>
            <p className="text-lg font-semibold text-gray-700">
              Arrastra archivos aquí o haz clic para seleccionar
            </p>
            <p className="text-sm text-gray-500 mt-1">
              CSV de inventario + Excel de configuración (opcional)
            </p>
          </div>
        </label>

        {/* File Status */}
        <div className="mt-6 space-y-2">
          {inventoryFile ? (
            <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-2 rounded-lg">
              <CheckCircle2 size={18} />
              <FileText size={18} />
              <span className="text-sm font-medium">{inventoryFile.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-400 px-4 py-2">
              <AlertCircle size={18} />
              <FileText size={18} />
              <span className="text-sm">Archivo CSV de inventario (requerido)</span>
            </div>
          )}

          {configFile ? (
            <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-2 rounded-lg">
              <CheckCircle2 size={18} />
              <FileSpreadsheet size={18} />
              <span className="text-sm font-medium">{configFile.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-400 px-4 py-2">
              <AlertCircle size={18} />
              <FileSpreadsheet size={18} />
              <span className="text-sm">Archivo Excel de configuración (opcional)</span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex gap-3 justify-center">
          {inventoryFile && (
            <>
              <button
                onClick={clearFiles}
                disabled={isProcessing}
                className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Limpiar
              </button>
              <button
                onClick={processUpload}
                disabled={isProcessing}
                className={cn(
                  "px-6 py-2 rounded-lg font-medium transition-all",
                  isProcessing
                    ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                    : "bg-reyna-accent text-white hover:bg-reyna-accent/90 shadow-lg shadow-reyna-accent/20"
                )}
              >
                {isProcessing ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Procesando...
                  </span>
                ) : (
                  'Procesar Archivos'
                )}
              </button>
            </>
          )}
        </div>
      </div>

      <p className="text-center text-sm text-gray-400 mt-4">
        💡 Tip: El archivo CSV debe contener las columnas: Clave, Descripcion, Existencia
      </p>
    </div>
  );
}
