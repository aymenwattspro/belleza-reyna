'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileSpreadsheet, FileText, Sparkles, CheckCircle2, ArrowRight, Trash2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { cleanInventoryData, processInventoryData, calculatePurchaseOrders } from '@/lib/utils/data-processing';
import { InventoryItem } from '@/lib/types/inventory';
import * as XLSX from 'xlsx';

interface UploadedFile {
  file: File;
  type: 'csv' | 'excel';
  data: any[];
}

export default function UploadPage() {
  const router = useRouter();
  const [csvFile, setCsvFile] = useState<UploadedFile | null>(null);
  const [excelFile, setExcelFile] = useState<UploadedFile | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detectedSupplier, setDetectedSupplier] = useState<{ name: string; minOrder: number } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [hasExistingData, setHasExistingData] = useState(false);

  // Check if there's existing data on mount
  useEffect(() => {
    const checkExistingData = () => {
      const hasData = !!(localStorage.getItem('reyna_inventory') || localStorage.getItem('reyna_supplier'));
      setHasExistingData(hasData);
    };
    checkExistingData();
  }, []);

  const clearDatabase = () => {
    localStorage.removeItem('reyna_inventory');
    localStorage.removeItem('reyna_supplier');
    localStorage.removeItem('reyna_targets');
    localStorage.removeItem('reyna_order_history');
    toast.success('Base de datos eliminada correctamente');
    setShowResetConfirm(false);
    setHasExistingData(false);
    // Clear current files too
    setCsvFile(null);
    setExcelFile(null);
    setDetectedSupplier(null);
  };

  const detectSupplierFromFilename = (filename: string) => {
    const lowerName = filename.toLowerCase();
    const suppliers: Record<string, { name: string; minOrder: number }> = {
      'pink up': { name: 'Pink Up', minOrder: 5000 },
      'beauty creations': { name: 'Beauty Creations', minOrder: 8000 },
      'bissu': { name: 'Bissu', minOrder: 10000 },
      'prosa': { name: 'Prosa', minOrder: 3000 },
      'reyna': { name: 'Reyna', minOrder: 0 }
    };
    
    for (const [key, data] of Object.entries(suppliers)) {
      if (lowerName.includes(key)) return data;
    }
    return { name: 'Desconocido', minOrder: 0 };
  };

  const handleFileUpload = useCallback(async (file: File, type: 'csv' | 'excel') => {
    try {
      if (type === 'csv') {
        const text = await file.text();
        const lines = text.split('\n').map(line => 
          line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''))
        ).filter(line => line.some(cell => cell !== ''));
        
        setCsvFile({ file, type, data: lines });
        const supplier = detectSupplierFromFilename(file.name);
        setDetectedSupplier(supplier);
        toast.success(`CSV cargado: ${supplier.name}`);
      } else {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[];
        
        // Debug: voir la structure exacte
        console.log('📊 Excel raw data (first 3 rows):', jsonData.slice(0, 3));
        console.log('📊 Excel headers row:', jsonData[0]);
        console.log('📊 Excel data row 1:', jsonData[1]);
        
        setExcelFile({ file, type, data: jsonData });
        toast.success('Excel de stock objetivo cargado');
      }
    } catch (error) {
      toast.error(`Error al cargar ${type === 'csv' ? 'CSV' : 'Excel'}: ${error}`);
    }
  }, []);

  const processFiles = async () => {
    if (!csvFile || !excelFile) {
      toast.error('Por favor sube ambos archivos: CSV de inventario y Excel de stock objetivo');
      return;
    }

    setIsProcessing(true);
    toast.loading('Procesando datos...', { id: 'processing' });

    try {
      // Process CSV inventory data
      const inventoryData = cleanInventoryData(csvFile.data, detectedSupplier?.name);
      console.log('📦 CSV Inventory items:', inventoryData.length);
      console.log('📦 CSV Sample (first 3):', inventoryData.slice(0, 3));
      
      // Process Excel target data
      const targetData = processInventoryData(excelFile.data);
      console.log('🎯 Excel Target items:', targetData.length);
      console.log('🎯 Excel Sample (first 3):', targetData.slice(0, 3));
      
      if (targetData.length === 0) {
        toast.error('El archivo Excel no contiene datos válidos. Verifica las columnas: Clave, Descripción, Stock_objetivo, Piezas', { id: 'processing' });
        setIsProcessing(false);
        return;
      }
      
      // Merge and calculate orders
      const mergedData = mergeInventoryWithTargets(inventoryData, targetData);
      
      // Log pour vérifier le merge
      console.log('🔀 Merged data (first 5):', mergedData.slice(0, 5).map(i => ({
        clave: i.clave,
        existencia: i.existencia,
        stockObjetivo: i.stockObjetivo,
        piezas: i.piezas,
        precioC: i.precioC
      })));
      
      // Calculate orders with the Python logic
      const ordersCalculated = calculatePurchaseOrders(mergedData);
      
      // Log des résultats
      console.log('📊 Calculated orders (first 5 with pedido > 0):', ordersCalculated
        .filter(i => (i.pedido || 0) > 0)
        .slice(0, 5)
        .map(i => ({
          clave: i.clave,
          existencia: i.existencia,
          stockObjetivo: i.stockObjetivo,
          pedido: i.pedido,
          valorPedido: i.valorPedido
        }))
      );
      
      // Save to localStorage
      localStorage.setItem('reyna_inventory', JSON.stringify(ordersCalculated));
      localStorage.setItem('reyna_supplier', JSON.stringify(detectedSupplier));
      localStorage.setItem('reyna_targets', JSON.stringify(targetData));
      
      toast.success('Datos procesados correctamente', { id: 'processing' });
      router.push('/orders');
    } catch (error) {
      console.error('Error processing files:', error);
      toast.error(`Error al procesar: ${error}`, { id: 'processing' });
    } finally {
      setIsProcessing(false);
    }
  };

  const mergeInventoryWithTargets = (inventory: InventoryItem[], targets: any[]): InventoryItem[] => {
    // Normaliser les clés pour la correspondance (enlever espaces, .0, etc.)
    // Ne pas convertir en minuscule pour garder la cohérence avec cleanInventoryData
    const targetMap = new Map(targets.map(t => {
      const normalizedKey = String(t.clave).trim().replace(/\.0$/, '');
      return [normalizedKey, t];
    }));
    
    console.log('Target Map keys (first 5):', Array.from(targetMap.keys()).slice(0, 5));
    console.log('Inventory keys (first 5):', inventory.slice(0, 5).map(i => i.clave));
    
    let matchedCount = 0;
    
    const result = inventory.map(item => {
      // Même normalisation que dans cleanInventoryData
      const normalizedItemKey = item.clave.trim().replace(/\.0$/, '');
      const target = targetMap.get(normalizedItemKey);
      
      if (target) {
        matchedCount++;
        console.log('✅ Match found:', item.clave, 'StockObj:', target.stockObjetivo, 'Piezas:', target.piezas);
        return {
          ...item,
          stockObjetivo: target.stockObjetivo || 0,
          piezas: target.piezas || 1,
          proveedor: item.proveedor || target.proveedor || detectedSupplier?.name || 'Desconocido'
        };
      }
      return item;
    });
    
    console.log(`Matched ${matchedCount} items out of ${inventory.length}`);
    if (matchedCount === 0) {
      toast.warning('⚠️ No se encontraron coincidencias entre CSV y Excel. Verifica que las claves sean iguales.');
    } else {
      toast.success(`${matchedCount} productos coinciden con el archivo Excel`);
    }
    
    return result;
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center animate-in fade-in zoom-in duration-700">
      <div className="text-center mb-12">
        <div className="w-32 h-32 rounded-full accent-gradient flex items-center justify-center text-white mb-8 shadow-2xl shadow-reyna-accent/20 mx-auto">
          <Sparkles size={64} className="animate-sparkle" />
        </div>
        <h1 className="text-4xl font-bold text-reyna-black mb-4">
          💄 Sistema de Inventario Reyna
        </h1>
        <p className="text-gray-500 text-lg max-w-md mx-auto">
          Sube tu CSV de inventario y tu Excel de stock objetivo para calcular los pedidos automáticamente.
        </p>
      </div>

      {/* Supplier Detection */}
      {detectedSupplier && (
        <div className="mb-8 px-6 py-3 bg-reyna-nude/50 rounded-2xl border border-reyna-pink-accent/20">
          <p className="text-reyna-accent font-semibold">
            🏢 Proveedor detectado: {detectedSupplier.name}
          </p>
          <p className="text-sm text-gray-500">
            💰 Mínimo de compra: ${detectedSupplier.minOrder.toLocaleString('es-MX')}
          </p>
        </div>
      )}

      {/* Upload Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl mb-8">
        {/* CSV Upload */}
        <div 
          className={cn(
            "relative group cursor-pointer rounded-3xl border-2 border-dashed p-8 transition-all duration-300",
            csvFile 
              ? "border-emerald-400 bg-emerald-50/50" 
              : "border-gray-300 hover:border-reyna-accent hover:bg-reyna-nude/30"
          )}
          onClick={() => document.getElementById('csv-input')?.click()}
        >
          <input
            id="csv-input"
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'csv')}
          />
          <div className="flex flex-col items-center text-center">
            <div className={cn(
              "w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-colors",
              csvFile ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-400 group-hover:bg-reyna-accent group-hover:text-white"
            )}>
              {csvFile ? <CheckCircle2 size={32} /> : <FileText size={32} />}
            </div>
            <h3 className="font-semibold text-gray-700 mb-1">
              {csvFile ? csvFile.file.name : 'CSV de Inventario'}
            </h3>
            <p className="text-sm text-gray-400">
              {csvFile ? 'Archivo cargado' : 'Click para subir archivo CSV'}
            </p>
          </div>
        </div>

        {/* Excel Upload */}
        <div 
          className={cn(
            "relative group cursor-pointer rounded-3xl border-2 border-dashed p-8 transition-all duration-300",
            excelFile 
              ? "border-emerald-400 bg-emerald-50/50" 
              : "border-gray-300 hover:border-reyna-accent hover:bg-reyna-nude/30"
          )}
          onClick={() => document.getElementById('excel-input')?.click()}
        >
          <input
            id="excel-input"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'excel')}
          />
          <div className="flex flex-col items-center text-center">
            <div className={cn(
              "w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-colors",
              excelFile ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-400 group-hover:bg-reyna-accent group-hover:text-white"
            )}>
              {excelFile ? <CheckCircle2 size={32} /> : <FileSpreadsheet size={32} />}
            </div>
            <h3 className="font-semibold text-gray-700 mb-1">
              {excelFile ? excelFile.file.name : 'Excel Stock Objetivo'}
            </h3>
            <p className="text-sm text-gray-400">
              {excelFile ? 'Archivo cargado' : 'Click para subir archivo Excel'}
            </p>
          </div>
        </div>
      </div>

      {/* Process Button */}
      <button
        onClick={processFiles}
        disabled={!csvFile || !excelFile || isProcessing}
        className={cn(
          "flex items-center gap-3 px-10 py-4 rounded-2xl font-bold text-lg transition-all",
          csvFile && excelFile && !isProcessing
            ? "bg-reyna-accent text-white shadow-xl shadow-reyna-accent/30 hover:scale-105"
            : "bg-gray-200 text-gray-400 cursor-not-allowed"
        )}
      >
        {isProcessing ? (
          <>
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Procesando...
          </>
        ) : (
          <>
            <Upload size={24} />
            Procesar Archivos
            <ArrowRight size={20} />
          </>
        )}
      </button>

      <p className="mt-6 text-sm text-gray-400">
        Ambos archivos son requeridos para calcular los pedidos correctamente.
      </p>

      {/* Reset Database Section */}
      <div className="mt-8 pt-8 border-t border-gray-200 w-full max-w-3xl">
        {showResetConfirm ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center animate-in fade-in zoom-in duration-300">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-red-700 mb-2">
              ¿Estás segura de eliminar la base de datos?
            </h3>
            <p className="text-sm text-red-600 mb-4">
              Se eliminarán todos los inventarios, proveedores e historial de pedidos. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-6 py-2 rounded-xl bg-gray-200 text-gray-700 font-medium hover:bg-gray-300 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={clearDatabase}
                className="px-6 py-2 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
              >
                Sí, eliminar todo
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowResetConfirm(true)}
            className={cn(
              "flex items-center gap-2 mx-auto px-6 py-3 rounded-xl font-medium transition-all",
              hasExistingData
                ? "bg-red-100 text-red-600 hover:bg-red-200"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            )}
            disabled={!hasExistingData}
          >
            <Trash2 size={20} />
            {hasExistingData ? 'Eliminar base de datos existente' : 'No hay datos para eliminar'}
          </button>
        )}
      </div>
    </div>
  );
}
