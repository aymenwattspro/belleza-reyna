'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, 
  Package, 
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Pencil,
  Save,
  X,
  DollarSign,
  Box,
  ShoppingCart,
  History
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { InventoryItem, Supplier, HistoryItem } from '@/lib/types/inventory';
import { toast } from 'sonner';

export default function ProductDetailPage({ params }: { params: Promise<{ id: string; clave: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [product, setProduct] = useState<InventoryItem | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<Partial<InventoryItem>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [resolvedParams.id, resolvedParams.clave]);

  const loadData = () => {
    const savedSuppliers = localStorage.getItem('reyna_managed_suppliers');
    const savedInventory = localStorage.getItem('reyna_inventory');
    const savedTargets = localStorage.getItem('reyna_targets');
    const savedHistory = localStorage.getItem('reyna_history');

    if (savedSuppliers) {
      const suppliers = JSON.parse(savedSuppliers);
      const foundSupplier = suppliers.find((s: Supplier) => s.id === resolvedParams.id);
      setSupplier(foundSupplier || null);
    }

    if (savedInventory) {
      const parsedInv = JSON.parse(savedInventory);
      const parsedTargets = savedTargets ? JSON.parse(savedTargets) : [];
      
      // Merge targets into inventory
      const targetMap = new Map<string, any>(parsedTargets.map((t: any) => [String(t.clave), t]));
      const merged = parsedInv.map((item: InventoryItem) => {
        const target = targetMap.get(item.clave);
        return {
          ...item,
          stockObjetivo: target?.stockObjetivo ?? 0,
          piezas: target?.piezas ?? 1
        };
      });

      const foundProduct = merged.find((item: InventoryItem) => item.clave === resolvedParams.clave);
      if (foundProduct) {
        setProduct(foundProduct);
        setEditValues(foundProduct);
      }
    }

    if (savedHistory) {
      const parsedHistory = JSON.parse(savedHistory);
      // Filter history for this specific product
      const productHistory = parsedHistory.filter((h: HistoryItem) => 
        h.items.some((item: InventoryItem) => item.clave === resolvedParams.clave)
      );
      setHistory(productHistory);
    }

    setLoading(false);
  };

  // Calculate order requirements
  const getOrderInfo = () => {
    if (!product) return { stockNeeded: 0, piecesToOrder: 0, lotsToOrder: 0, totalOrderValue: 0, currentLots: 0, targetLots: 0 };
    
    const stockNeeded = (product.stockObjetivo || 0) - product.existencia;
    const piecesToOrder = Math.max(0, stockNeeded);
    const piecesPerLot = product.piezas || 1;
    const lotsToOrder = piecesPerLot > 0 ? Math.ceil(piecesToOrder / piecesPerLot) : 0;
    const totalOrderValue = piecesToOrder * product.precioC;
    const currentLots = piecesPerLot > 0 ? Math.floor(product.existencia / piecesPerLot) : 0;
    const targetLots = piecesPerLot > 0 ? Math.ceil((product.stockObjetivo || 0) / piecesPerLot) : 0;
    
    return { stockNeeded, piecesToOrder, lotsToOrder, totalOrderValue, currentLots, targetLots };
  };

  const handleSave = () => {
    if (!product) return;

    // Update inventory
    const savedInventory = localStorage.getItem('reyna_inventory');
    if (savedInventory) {
      const parsedInv = JSON.parse(savedInventory);
      const updatedInv = parsedInv.map((item: InventoryItem) => 
        item.clave === product.clave ? { ...item, ...editValues } : item
      );
      localStorage.setItem('reyna_inventory', JSON.stringify(updatedInv));
    }

    // Update targets
    const savedTargets = localStorage.getItem('reyna_targets');
    if (savedTargets) {
      const parsedTargets = JSON.parse(savedTargets);
      const updatedTargets = parsedTargets.map((t: any) => 
        t.clave === product.clave ? { ...t, stockObjetivo: editValues.stockObjetivo, piezas: editValues.piezas } : t
      );
      
      // If target doesn't exist, add it
      if (!updatedTargets.find((t: any) => t.clave === product.clave)) {
        updatedTargets.push({ 
          clave: product.clave, 
          stockObjetivo: editValues.stockObjetivo, 
          piezas: editValues.piezas,
          descripcion: editValues.descripcion 
        });
      }
      
      localStorage.setItem('reyna_targets', JSON.stringify(updatedTargets));
    }

    setProduct({ ...product, ...editValues } as InventoryItem);
    setIsEditing(false);
    toast.success('Producto actualizado correctamente');
    loadData();
  };

  const { stockNeeded, piecesToOrder, lotsToOrder, totalOrderValue, currentLots, targetLots } = getOrderInfo();
  const isLowStock = product && product.existencia < (product.stockObjetivo || 10) * 0.2;
  const needsOrder = stockNeeded > 0;
  const remainingStock = stockNeeded > 0 ? 0 : Math.abs(stockNeeded);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-16 h-16 border-4 border-reyna-pink-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!product || !supplier) {
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <button 
          onClick={() => router.push(`/suppliers/${resolvedParams.id}`)}
          className="flex items-center gap-2 text-gray-500 hover:text-reyna-accent transition-colors"
        >
          <ArrowLeft size={20} />
          Volver a Productos
        </button>
        <div className="text-center py-24">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Producto no encontrado</h2>
          <p className="text-gray-500">El producto que buscas no existe.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button 
          onClick={() => router.push(`/suppliers/${resolvedParams.id}`)}
          className="p-2 rounded-xl bg-white border border-gray-200 text-gray-500 hover:text-reyna-accent hover:border-reyna-pink-accent transition-all"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-reyna-black">{product.descripcion}</h1>
          <p className="text-gray-500">{supplier.name} • {product.clave}</p>
        </div>
        {!isEditing ? (
          <button 
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-white border border-reyna-pink-accent/20 text-reyna-accent font-semibold hover:bg-reyna-pink/30 transition-all"
          >
            <Pencil size={18} />
            Editar
          </button>
        ) : (
          <div className="flex gap-2">
            <button 
              onClick={handleSave}
              className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition-all"
            >
              <Save size={18} />
              Guardar
            </button>
            <button 
              onClick={() => {
                setIsEditing(false);
                setEditValues(product);
              }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-gray-100 text-gray-600 font-semibold hover:bg-gray-200 transition-all"
            >
              <X size={18} />
              Cancelar
            </button>
          </div>
        )}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product Info Card */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stock Information */}
          <div className="glass-card p-8 rounded-[2.5rem] border-white/50">
            <h2 className="text-xl font-bold text-reyna-black mb-6 flex items-center gap-2">
              <Package size={24} className="text-reyna-accent" />
              Información de Stock
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                    Stock Actual
                  </label>
                  {isEditing ? (
                    <input 
                      type="number"
                      value={editValues.existencia}
                      onChange={e => setEditValues({...editValues, existencia: parseFloat(e.target.value)})}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-reyna-pink-accent/30 outline-none font-bold text-lg"
                    />
                  ) : (
                    <div className={cn("text-3xl font-bold", isLowStock ? "text-rose-500" : "text-gray-700")}>
                      {product.existencia}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                    Stock Objetivo
                  </label>
                  {isEditing ? (
                    <input 
                      type="number"
                      value={editValues.stockObjetivo || 0}
                      onChange={e => setEditValues({...editValues, stockObjetivo: parseFloat(e.target.value)})}
                      className="w-full px-4 py-3 bg-white border border-reyna-pink-accent/30 rounded-xl focus:ring-2 focus:ring-reyna-pink-accent/30 outline-none font-bold text-lg text-reyna-accent"
                    />
                  ) : (
                    <div className="text-3xl font-bold text-reyna-accent">
                      {product.stockObjetivo || 0}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                    Piezas por Lote
                  </label>
                  {isEditing ? (
                    <input 
                      type="number"
                      value={editValues.piezas || 1}
                      onChange={e => setEditValues({...editValues, piezas: parseFloat(e.target.value)})}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-reyna-pink-accent/30 outline-none font-bold text-lg"
                    />
                  ) : (
                    <div className="text-3xl font-bold text-gray-700">
                      {product.piezas || 1}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                    Estado
                  </label>
                  {isLowStock ? (
                    <div className="flex items-center gap-2 text-rose-500 font-bold text-sm uppercase px-3 py-2 bg-rose-50 rounded-xl w-fit">
                      <AlertCircle size={16} />
                      Stock Bajo
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-emerald-600 font-bold text-sm uppercase px-3 py-2 bg-emerald-50 rounded-xl w-fit">
                      <CheckCircle2 size={16} />
                      Stock OK
                    </div>
                  )}
                </div>
              </div>
            </div>

            {needsOrder && (
              <div className="mt-6 p-6 bg-amber-50 rounded-2xl border border-amber-200">
                <h3 className="font-bold text-amber-800 mb-4 flex items-center gap-2">
                  <ShoppingCart size={20} />
                  Se Necesita Reabastecer
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-amber-700">{stockNeeded}</div>
                    <div className="text-xs text-amber-600 uppercase tracking-widest">Piezas Faltantes</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-amber-700">{piecesToOrder}</div>
                    <div className="text-xs text-amber-600 uppercase tracking-widest">A Pedir</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-amber-700">{lotsToOrder}</div>
                    <div className="text-xs text-amber-600 uppercase tracking-widest">Lotes</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Price Information */}
          <div className="glass-card p-8 rounded-[2.5rem] border-white/50">
            <h2 className="text-xl font-bold text-reyna-black mb-6 flex items-center gap-2">
              <DollarSign size={24} className="text-emerald-500" />
              Información de Precio
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                  Precio de Compra (Proveedor)
                </label>
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">$</span>
                    <input 
                      type="number"
                      step="0.01"
                      value={editValues.precioC}
                      onChange={e => setEditValues({...editValues, precioC: parseFloat(e.target.value)})}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-reyna-pink-accent/30 outline-none font-bold text-lg"
                    />
                  </div>
                ) : (
                  <div className="text-3xl font-bold text-gray-700">
                    ${product.precioC.toFixed(2)}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                  Precio de Venta (Unidad)
                </label>
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">$</span>
                    <input 
                      type="number"
                      step="0.01"
                      value={editValues.precioV || ''}
                      onChange={e => setEditValues({...editValues, precioV: parseFloat(e.target.value) || undefined})}
                      className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-reyna-pink-accent/30 outline-none font-bold text-lg"
                    />
                  </div>
                ) : (
                  <div className="text-3xl font-bold text-reyna-accent">
                    ${product.precioV ? product.precioV.toFixed(2) : 'N/A'}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                  Precio por Lote (Compra)
                </label>
                <div className="text-3xl font-bold text-gray-700">
                  ${((product.piezas || 1) * product.precioC).toFixed(2)}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">
                  Margen de Ganancia
                </label>
                <div className="text-3xl font-bold text-emerald-600">
                  {product.precioV ? ((product.precioV - product.precioC) / product.precioV * 100).toFixed(1) : 'N/A'}%
                </div>
              </div>
            </div>

            {needsOrder && (
              <div className="mt-6 p-6 bg-reyna-pink/20 rounded-2xl border border-reyna-pink-accent/30">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 font-semibold">Valor Total del Pedido:</span>
                  <span className="text-3xl font-bold text-reyna-accent">${totalOrderValue.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Lots Information */}
          <div className="glass-card p-8 rounded-[2.5rem] border-white/50">
            <h2 className="text-xl font-bold text-reyna-black mb-6 flex items-center gap-2">
              <Box size={24} className="text-reyna-accent" />
              Información de Lotes
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center p-4 bg-white/50 rounded-xl">
                <div className="text-3xl font-bold text-gray-700">{currentLots}</div>
                <div className="text-xs text-gray-500 uppercase tracking-widest mt-2">Lotes Actuales en Tienda</div>
              </div>
              <div className="text-center p-4 bg-reyna-pink/20 rounded-xl border border-reyna-pink-accent/30">
                <div className="text-3xl font-bold text-reyna-accent">{targetLots}</div>
                <div className="text-xs text-reyna-accent uppercase tracking-widest mt-2">Lotes Necesarios en Total</div>
              </div>
              <div className="text-center p-4 bg-white/50 rounded-xl">
                <div className="text-3xl font-bold text-gray-700">{lotsToOrder}</div>
                <div className="text-xs text-gray-500 uppercase tracking-widest mt-2">Lotes a Comprar</div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex justify-between items-center p-4 bg-white/50 rounded-xl">
                <span className="text-gray-500">Stock Restante:</span>
                <span className="font-bold text-gray-700">{remainingStock}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-white/50 rounded-xl">
                <span className="text-gray-500">Piezas por Lote:</span>
                <span className="font-bold text-gray-700">{product.piezas || 1}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Order History */}
        <div className="glass-card p-8 rounded-[2.5rem] border-white/50">
          <h2 className="text-xl font-bold text-reyna-black mb-6 flex items-center gap-2">
            <History size={24} className="text-reyna-accent" />
            Historial de Pedidos
          </h2>
          
          {history.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-reyna-nude rounded-full flex items-center justify-center mx-auto mb-4 text-reyna-pink-accent/40">
                <History size={32} />
              </div>
              <p className="text-gray-500 text-sm">No hay historial de pedidos para este producto</p>
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((h) => {
                const productInOrder = h.items.find((item: InventoryItem) => item.clave === resolvedParams.clave);
                if (!productInOrder) return null;
                
                const orderQuantity = productInOrder.pedido || 0;
                const orderValue = orderQuantity * productInOrder.precioC;
                const lotsOrdered = productInOrder.piezas ? Math.ceil(orderQuantity / productInOrder.piezas) : 0;

                return (
                  <div key={h.id} className="p-4 bg-white/50 rounded-xl border border-gray-100">
                    <div className="text-xs text-gray-400 mb-2">{h.date}</div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Cantidad:</span>
                        <span className="font-semibold">{orderQuantity}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Lotes:</span>
                        <span className="font-semibold">{lotsOrdered}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Valor Total:</span>
                        <span className="font-bold text-reyna-accent">${orderValue.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
