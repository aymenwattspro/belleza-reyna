'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  Package,
  DollarSign,
  Building2,
  Filter,
  History
} from 'lucide-react';
import { useOrderHistory } from '@/contexts/OrderHistoryContext';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

export default function OrderHistoryPage() {
  const { orders, getOrdersBySupplier, getPendingOrders, clearHistory } = useOrderHistory();
  const [selectedSupplier, setSelectedSupplier] = useState<string>('all');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Filter orders by supplier
  const filteredOrders = selectedSupplier === 'all' 
    ? orders 
    : getOrdersBySupplier(selectedSupplier);

  // Get unique suppliers
  const suppliers = Array.from(new Set(orders.map(order => order.supplierName)));

  // Calculate stats
  const totalOrders = orders.length;
  const pendingOrders = getPendingOrders().length;
  const completedOrders = orders.filter(o => o.status === 'completed').length;
  const totalValue = orders.reduce((sum, order) => sum + order.totalAmount, 0);

  const updateOrderStatus = (orderId: string, status: 'completed' | 'cancelled') => {
    // This would typically update order status
    // For now, we'll just show the status
    console.log(`Order ${orderId} status updated to ${status}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/inventory-hub/action" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft size={20} className="text-gray-600" />
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-800">Historial de Pedidos</h1>
                <p className="text-sm text-gray-500">
                  {totalOrders} pedidos • {pendingOrders} pendientes
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Supplier Filter */}
              <div className="flex items-center gap-2">
                <Building2 size={18} className="text-gray-400" />
                <select
                  value={selectedSupplier}
                  onChange={(e) => setSelectedSupplier(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-gray-200 focus:border-blue-500 outline-none bg-white"
                >
                  <option value="all">Todos los proveedores</option>
                  {suppliers.map(supplier => (
                    <option key={supplier} value={supplier}>{supplier}</option>
                  ))}
                </select>
              </div>

              {/* Clear History */}
              <button
                onClick={() => setShowClearConfirm(true)}
                className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                title="Limpiar historial"
              >
                <History size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <Package size={20} className="text-blue-600" />
              <span className="text-sm text-gray-500">Total Pedidos</span>
            </div>
            <p className="text-2xl font-bold text-gray-800">{totalOrders}</p>
          </div>

          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <Clock size={20} className="text-yellow-600" />
              <span className="text-sm text-gray-500">Pendientes</span>
            </div>
            <p className="text-2xl font-bold text-yellow-600">{pendingOrders}</p>
          </div>

          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle2 size={20} className="text-emerald-600" />
              <span className="text-sm text-gray-500">Completados</span>
            </div>
            <p className="text-2xl font-bold text-emerald-600">{completedOrders}</p>
          </div>

          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <DollarSign size={20} className="text-purple-600" />
              <span className="text-sm text-gray-500">Valor Total</span>
            </div>
            <p className="text-2xl font-bold text-purple-700">
              ${totalValue.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
            </p>
          </div>
        </div>

        {/* Orders List */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <History size={20} className="text-gray-600" />
              <h3 className="text-lg font-semibold text-gray-800">
                Historial de Pedidos {selectedSupplier !== 'all' && `- ${selectedSupplier}`}
              </h3>
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="text-center py-16">
              <Package size={64} className="mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-semibold text-gray-600 mb-2">No hay pedidos</h3>
              <p className="text-gray-500">
                {selectedSupplier === 'all' 
                  ? 'No se han realizado pedidos aún'
                  : `No hay pedidos para ${selectedSupplier}`
                }
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredOrders.map((order) => (
                <div key={order.id} className="p-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-gray-100 rounded-lg">
                          <Calendar size={16} className="text-gray-600" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-800">
                            Pedido #{order.id.split('_')[1]}
                          </h4>
                          <p className="text-sm text-gray-500">
                            {format(order.date, 'PPp', { locale: es })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "px-2 py-1 rounded-full text-xs font-medium",
                            order.status === 'pending' ? "bg-yellow-100 text-yellow-700" :
                            order.status === 'completed' ? "bg-emerald-100 text-emerald-700" :
                            "bg-red-100 text-red-700"
                          )}>
                            {order.status === 'pending' ? 'Pendiente' :
                             order.status === 'completed' ? 'Completado' : 'Cancelado'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-gray-500 mb-1">Proveedor</p>
                          <p className="font-medium text-gray-800">{order.supplierName}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500 mb-1">Valor Total</p>
                          <p className="font-bold text-gray-800">
                            ${order.totalAmount.toLocaleString('es-MX', { maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>

                      {/* Order Items */}
                      <div className="mt-4">
                        <p className="text-sm font-medium text-gray-700 mb-2">Productos ({order.items.length})</p>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <div className="space-y-2 max-h-32 overflow-y-auto">
                            {order.items.slice(0, 5).map((item, index) => (
                              <div key={index} className="flex justify-between items-center text-sm">
                                <div className="flex-1">
                                  <span className="font-medium text-gray-800">{item.clave}</span>
                                  <span className="text-gray-500 ml-2 truncate">{item.descripcion}</span>
                                </div>
                                <div className="text-right">
                                  <span className="font-bold text-gray-800">{item.cantidad}</span>
                                  <span className="text-gray-400 ml-1">×</span>
                                  <span className="text-gray-600">${item.precioUnit.toFixed(2)}</span>
                                  <span className="text-gray-400">=</span>
                                  <span className="font-bold text-emerald-600">${item.total.toFixed(2)}</span>
                                </div>
                              </div>
                            ))}
                            {order.items.length > 5 && (
                              <p className="text-xs text-gray-400 text-center pt-2">
                                +{order.items.length - 5} más productos...
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Actions for pending orders */}
                      {order.status === 'pending' && (
                        <div className="flex gap-2 mt-4">
                          <button
                            onClick={() => updateOrderStatus(order.id, 'completed')}
                            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
                          >
                            Marcar como Completado
                          </button>
                          <button
                            onClick={() => updateOrderStatus(order.id, 'cancelled')}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                          >
                            Cancelar Pedido
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-gray-800 mb-2">¿Limpiar Historial?</h3>
            <p className="text-gray-500 mb-4">
              Esta acción eliminará permanentemente todo el historial de pedidos.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={() => { clearHistory(); setShowClearConfirm(false); }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                Limpiar Historial
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
