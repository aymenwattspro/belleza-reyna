'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  Package,
  Target,
  AlertCircle
} from 'lucide-react';
import { useStockTarget } from '@/contexts/StockTargetContext';
import { parseStockTargetExcel } from '@/lib/utils/stock-target-parser';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function StockTargetPage() {
  const { stockTargets, addStockTargets, clearStockTargets } = useStockTarget();
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stockTargetFile, setStockTargetFile] = useState<File | null>(null);

  // Handle drag events
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processFiles(files);
  };

  const processFiles = async (files: File[]) => {
    for (const file of files) {
      const ext = file.name.toLowerCase();
      if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
        setStockTargetFile(file);
        toast.success(`Excel: ${file.name}`);
      }
    }
  };

  const processUpload = async () => {
    if (!stockTargetFile) {
      toast.error('Selecciona el archivo de stock objetivo');
      return;
    }

    setIsProcessing(true);
    const toastId = toast.loading('Procesando stock objetivo...');

    try {
      const targets = await parseStockTargetExcel(stockTargetFile);
      addStockTargets(targets);
      toast.success(`${targets.length} productos de stock objetivo importados`, { id: toastId });
      setStockTargetFile(null);
    } catch (error) {
      toast.error(`Error: ${error instanceof Error ? error.message : 'Desconocido'}`, { id: toastId });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-gray-200/50 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/inventory-hub/action" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft size={20} className="text-gray-600" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Stock Objetivo
                </h1>
                <p className="text-sm text-gray-500">
                  {stockTargets.length} productos con stock objetivo configurado
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={clearStockTargets}
                disabled={stockTargets.length === 0}
                className="p-2 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                title="Limpiar stock objetivo"
              >
                <AlertCircle size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Upload Zone */}
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Importar Stock Objetivo</h2>

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
            onClick={() => document.getElementById('stock-target-input')?.click()}
          >
            <div className="relative">
              <Target size={48} className={cn(
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
              {isDragging ? 'Suelta el archivo aquí' : 'Arrastra el archivo o haz clic'}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Excel con stock objetivo (FORMATO PINK UP MARZO261.xlsx)
            </p>
            <input
              id="stock-target-input"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* File Status */}
          <div className="mt-4 flex items-center justify-between">
            {stockTargetFile ? (
              <div className="flex items-center gap-2 text-sm text-purple-600 bg-purple-50 px-3 py-2 rounded-lg border border-purple-200">
                <CheckCircle2 size={14} />
                <FileSpreadsheet size={14} />
                <span className="font-medium">{stockTargetFile.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-400 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                <FileSpreadsheet size={14} />
                <span>FORMATO...xlsx</span>
              </div>
            )}

            {stockTargetFile && (
              <button
                onClick={processUpload}
                disabled={isProcessing}
                className="ml-auto px-6 py-2 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-lg text-sm font-medium hover:from-purple-700 hover:to-purple-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform hover:scale-105"
              >
                {isProcessing ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Procesando...
                  </span>
                ) : (
                  'Importar Stock Objetivo'
                )}
              </button>
            )}
          </div>
        </div>

        {/* Info Section */}
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Package size={24} className="text-blue-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-800 mb-2">¿Qué es el Stock Objetivo?</h3>
              <p className="text-gray-600 mb-3">
                El stock objetivo es la cantidad mínima de productos que debes tener en tienda. 
                El sistema calculará automáticamente la diferencia entre tu stock actual y el objetivo 
                para generar las órdenes de compra.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-sm text-gray-500 mb-1">Stock Actual</p>
                  <p className="font-bold text-gray-800">Viene de obtener.csv</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-sm text-gray-500 mb-1">Stock Objetivo</p>
                  <p className="font-bold text-purple-600">Viene de FORMATO...xlsx</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-sm text-gray-500 mb-1">A Pedir</p>
                  <p className="font-bold text-emerald-600">Diferencia automática</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stock Targets List */}
        {stockTargets.length > 0 && (
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">Stock Objetivo Configurado</h3>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <div className="divide-y divide-gray-100">
                {stockTargets.slice(0, 20).map((target, index) => (
                  <div key={target.clave} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-gray-800">{target.clave}</p>
                        <p className="text-sm text-gray-500 truncate">{target.descripcion}</p>
                        <p className="text-xs text-gray-400">{target.proveedor}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-purple-600">{target.stockObjetivo}</p>
                        <p className="text-xs text-gray-400">unidades</p>
                        {target.piezas > 1 && (
                          <p className="text-xs text-blue-500">{target.piezas} pz/lote</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {stockTargets.length > 20 && (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    +{stockTargets.length - 20} más productos...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
