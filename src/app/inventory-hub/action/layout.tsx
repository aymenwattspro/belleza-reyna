'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Package,
  BarChart3,
  Users,
  Activity,
  Target,
  ArrowLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrderHistoryProvider } from '@/contexts/OrderHistoryContext';
import { StockTargetProvider } from '@/contexts/StockTargetContext';

export default function ActionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  
  const subNavItems = [
    { name: 'Pedidos Priorizados', href: '/inventory-hub/action', icon: Package },
    { name: 'Dashboard', href: '/inventory-hub/action/dashboard', icon: BarChart3 },
    { name: 'Pedidos por Proveedor', href: '/inventory-hub/action/pedidos', icon: Users },
    { name: 'Stock Objetivo', href: '/inventory-hub/action/stock-target', icon: Target },
    { name: 'Historial', href: '/inventory-hub/action/historial', icon: Activity },
  ];

  return (
    <OrderHistoryProvider>
      <StockTargetProvider>
        <div className="flex flex-col h-full">
          {/* Sub Navigation */}
          <div className="bg-white border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-6 py-3">
              <div className="flex items-center gap-6">
                <Link
                  href="/inventory-hub"
                  className="flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  <ArrowLeft size={16} />
                  <span className="text-sm">Volver</span>
                </Link>
                
                <div className="flex items-center gap-1">
                  {subNavItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                          isActive
                            ? "bg-reyna-pink text-reyna-accent"
                            : "text-gray-600 hover:bg-gray-100 hover:text-gray-800"
                        )}
                      >
                        <item.icon size={16} />
                        {item.name}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Page Content */}
          <div className="flex-1">
            {children}
          </div>
        </div>
      </StockTargetProvider>
    </OrderHistoryProvider>
  );
}
