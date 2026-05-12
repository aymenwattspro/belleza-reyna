'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Package, TrendingUp, Users, DollarSign, Activity } from 'lucide-react';
import { useInventory } from '@/contexts/InventoryContext';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function DashboardPage() {
  const { latestSnapshot, popularityScores } = useInventory();

  if (!latestSnapshot) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Package size={64} className="mx-auto text-gray-300 mb-4" />
          <h2 className="text-xl font-semibold text-gray-600 mb-2">No hay datos</h2>
          <p className="text-gray-500">Importa datos desde Product Behavior</p>
        </div>
      </div>
    );
  }

  // Calculate stats
  const totalProducts = latestSnapshot.products.length;
  const totalValue = latestSnapshot.products.reduce((sum, p) => sum + (p.existencia * (p.precioC || 0)), 0);
  const outOfStock = latestSnapshot.products.filter(p => p.existencia === 0).length;
  const lowStock = latestSnapshot.products.filter(p => {
    const target = p.stockObjetivo || 0;
    return target > 0 && p.existencia < target * 0.3;
  }).length;
  const topProducts = popularityScores.slice(0, 5);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/inventory-hub/action" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft size={20} className="text-gray-600" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-800">Dashboard</h1>
              <p className="text-sm text-gray-500">
                Datos del: {format(latestSnapshot.date, 'PPp', { locale: es })}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Package size={24} className="text-blue-600" />
              </div>
              <span className="text-sm text-gray-500">Total</span>
            </div>
            <h3 className="text-2xl font-bold text-gray-800">{totalProducts}</h3>
            <p className="text-sm text-gray-500">Productos</p>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-emerald-100 rounded-lg">
                <DollarSign size={24} className="text-emerald-600" />
              </div>
              <span className="text-sm text-gray-500">Valor</span>
            </div>
            <h3 className="text-2xl font-bold text-gray-800">
              ${totalValue.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
            </h3>
            <p className="text-sm text-gray-500">Inventario actual</p>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-red-100 rounded-lg">
                <Activity size={24} className="text-red-600" />
              </div>
              <span className="text-sm text-gray-500">Crítico</span>
            </div>
            <h3 className="text-2xl font-bold text-red-600">{outOfStock}</h3>
            <p className="text-sm text-gray-500">Sin stock</p>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-yellow-100 rounded-lg">
                <TrendingUp size={24} className="text-yellow-600" />
              </div>
              <span className="text-sm text-gray-500">Bajo</span>
            </div>
            <h3 className="text-2xl font-bold text-yellow-600">{lowStock}</h3>
            <p className="text-sm text-gray-500">Stock bajo</p>
          </div>
        </div>

        {/* Top Products */}
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Top Productos Populares</h3>
            <div className="space-y-3">
              {topProducts.map((product, index) => (
                <div key={product.clave} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-reyna-accent text-white rounded-full flex items-center justify-center text-sm font-bold">
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">{product.descripcion}</p>
                      <p className="text-sm text-gray-500">{product.clave}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-emerald-600">{product.overallScore.toFixed(0)}</p>
                    <p className="text-xs text-gray-500">Score</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Acciones Rápidas</h3>
            <div className="space-y-3">
              <Link
                href="/inventory-hub/action"
                className="flex items-center justify-between p-4 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-600 rounded-lg">
                    <Package size={20} className="text-white" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">Pedidos Priorizados</p>
                    <p className="text-sm text-gray-500">Ver lista de compras</p>
                  </div>
                </div>
                <ArrowLeft size={16} className="text-gray-400 rotate-180" />
              </Link>

              <Link
                href="/inventory-hub/action/pedidos"
                className="flex items-center justify-between p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-600 rounded-lg">
                    <Users size={20} className="text-white" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">Pedidos por Proveedor</p>
                    <p className="text-sm text-gray-500">Ver por proveedor</p>
                  </div>
                </div>
                <ArrowLeft size={16} className="text-gray-400 rotate-180" />
              </Link>

              <Link
                href="/inventory-hub/action/historial"
                className="flex items-center justify-between p-4 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-600 rounded-lg">
                    <Activity size={20} className="text-white" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">Historial de Cambios</p>
                    <p className="text-sm text-gray-500">Ver timeline</p>
                  </div>
                </div>
                <ArrowLeft size={16} className="text-gray-400 rotate-180" />
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
