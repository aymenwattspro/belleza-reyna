'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { History, LayoutDashboard, Building2, Upload, Trash2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { inventoryDB } from '@/lib/db/inventory-db';
import { InventorySnapshot } from '@/lib/types/inventory-timeline';
import { UploadZone } from '@/components/inventory/UploadZone';
import { TimelineView } from '@/components/inventory/TimelineView';
import { DashboardView } from '@/components/inventory/DashboardView';
import { SupplierView } from '@/components/inventory/SupplierView';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

type TabId = 'upload' | 'timeline' | 'dashboard' | 'suppliers';

export default function InventoryTimelinePage() {
  const [activeTab, setActiveTab] = useState<TabId>('upload');
  const [snapshots, setSnapshots] = useState<InventorySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Load snapshots from IndexedDB
  const loadSnapshots = useCallback(async () => {
    try {
      setLoading(true);

      // Initialize DB
      await inventoryDB.init();

      // Get snapshots
      const snapshotData = await inventoryDB.getSnapshots();

      // Load full data for each snapshot
      const fullSnapshots: InventorySnapshot[] = [];

      for (const snapshotMeta of snapshotData.slice(0, 20)) { // Limit to last 20
        const fullData = await inventoryDB.getSnapshotById(snapshotMeta.id);
        if (fullData) {
          fullSnapshots.push({
            id: fullData.snapshot.id,
            date: new Date(fullData.snapshot.date),
            timestamp: fullData.snapshot.timestamp,
            fileName: fullData.snapshot.fileName,
            supplierName: fullData.snapshot.supplierName,
            products: fullData.products.map((p: any) => ({
              clave: p.clave,
              descripcion: p.descripcion,
              existencia: p.existencia,
              precioC: p.precioC,
              precioV: p.precioV,
              proveedor: p.proveedor,
              stockObjetivo: p.stockObjetivo,
              piezas: p.piezas
            }))
          });
        }
      }

      setSnapshots(fullSnapshots);

      // Auto-switch to dashboard if we have snapshots
      if (fullSnapshots.length > 0 && activeTab === 'upload') {
        setActiveTab('dashboard');
      }
    } catch (error) {
      console.error('Error loading snapshots:', error);
      toast.error('Error al cargar los datos guardados');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const handleUploadComplete = () => {
    loadSnapshots();
    toast.success('Datos cargados correctamente');
  };

  const clearAllData = async () => {
    try {
      await inventoryDB.clearAll();
      setSnapshots([]);
      setShowClearConfirm(false);
      toast.success('Todos los datos han sido eliminados');
      setActiveTab('upload');
    } catch (error) {
      toast.error('Error al eliminar los datos');
      console.error(error);
    }
  };

  const tabs = [
    { id: 'upload' as TabId, label: 'Subir Datos', icon: Upload },
    { id: 'dashboard' as TabId, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'timeline' as TabId, label: 'Timeline', icon: History },
    { id: 'suppliers' as TabId, label: 'Proveedores', icon: Building2 },
  ];

  const currentSnapshot = snapshots[0]; // Most recent

  return (
    <div className="min-h-screen bg-reyna-nude">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-reyna-accent flex items-center justify-center">
                <History size={18} className="text-white" />
              </div>
              <h1 className="text-xl font-bold text-gray-800">Inventory Timeline</h1>
            </div>

            <div className="flex items-center gap-4">
              {snapshots.length > 0 && (
                <span className="text-sm text-gray-500">
                  {snapshots.length} snapshots guardados
                </span>
              )}

              {snapshots.length > 0 && (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                  title="Eliminar todos los datos"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1 -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all",
                  activeTab === tab.id
                    ? "border-reyna-accent text-reyna-accent"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                )}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-reyna-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {activeTab === 'upload' && (
              <div className="space-y-6">
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-bold text-gray-800 mb-2">
                    Sube tu Inventario
                  </h2>
                  <p className="text-gray-500">
                    Sube archivos CSV de inventario para crear snapshots y analizar el comportamiento de tus productos
                  </p>
                </div>

                <UploadZone onUploadComplete={handleUploadComplete} />

                {snapshots.length > 0 && (
                  <div className="mt-12">
                    <h3 className="text-lg font-semibold text-gray-700 mb-4">Snapshots Anteriores</h3>
                    <div className="space-y-2">
                      {snapshots.slice(0, 10).map((snapshot) => (
                        <div
                          key={snapshot.id}
                          className="flex items-center justify-between p-4 bg-white rounded-xl border border-gray-200"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                              <History size={18} className="text-gray-500" />
                            </div>
                            <div>
                              <p className="font-medium text-gray-800">{snapshot.fileName}</p>
                              <p className="text-sm text-gray-500">
                                {format(snapshot.date, 'PPp', { locale: es })} • {snapshot.products.length} productos
                                {snapshot.supplierName && ` • ${snapshot.supplierName}`}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'dashboard' && currentSnapshot && (
              <DashboardView snapshot={currentSnapshot} />
            )}

            {activeTab === 'timeline' && (
              <TimelineView snapshots={snapshots} />
            )}

            {activeTab === 'suppliers' && currentSnapshot && (
              <SupplierView snapshot={currentSnapshot} />
            )}

            {!currentSnapshot && activeTab !== 'upload' && (
              <div className="text-center py-16">
                <History size={64} className="mx-auto text-gray-300 mb-4" />
                <h3 className="text-xl font-semibold text-gray-600 mb-2">No hay datos disponibles</h3>
                <p className="text-gray-500 mb-6">
                  Sube tu primer archivo de inventario para comenzar a analizar
                </p>
                <button
                  onClick={() => setActiveTab('upload')}
                  className="px-6 py-3 bg-reyna-accent text-white rounded-xl font-medium hover:bg-reyna-accent/90 transition-colors"
                >
                  Subir Datos
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Clear Data Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle size={24} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-800">¿Eliminar todos los datos?</h3>
            </div>

            <p className="text-gray-600 mb-6">
              Esta acción eliminará permanentemente todos los snapshots guardados y no se puede deshacer.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={clearAllData}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors"
              >
                Eliminar Todo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
