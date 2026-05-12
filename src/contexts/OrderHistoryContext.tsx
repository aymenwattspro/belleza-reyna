'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface OrderHistory {
  id: string;
  date: Date;
  supplierName: string;
  totalAmount: number;
  items: {
    clave: string;
    descripcion: string;
    cantidad: number;
    precioUnit: number;
    total: number;
  }[];
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: Date;
}

interface OrderHistoryContextType {
  orders: OrderHistory[];
  addOrder: (order: Omit<OrderHistory, 'id' | 'createdAt'>) => void;
  updateOrderStatus: (orderId: string, status: OrderHistory['status']) => void;
  getOrdersBySupplier: (supplierName: string) => OrderHistory[];
  getPendingOrders: () => OrderHistory[];
  clearHistory: () => void;
}

const OrderHistoryContext = createContext<OrderHistoryContextType | undefined>(undefined);

export function OrderHistoryProvider({ children }: { children: React.ReactNode }) {
  const [orders, setOrders] = useState<OrderHistory[]>([]);

  const addOrder = useCallback((order: Omit<OrderHistory, 'id' | 'createdAt'>) => {
    const newOrder: OrderHistory = {
      ...order,
      id: `order_${Date.now()}`,
      createdAt: new Date(),
      status: 'pending'
    };
    
    setOrders(prev => [newOrder, ...prev]);
    
    // Save to localStorage for persistence
    if (typeof window !== 'undefined') {
      const savedOrders = JSON.parse(localStorage.getItem('orderHistory') || '[]');
      savedOrders.push(newOrder);
      localStorage.setItem('orderHistory', JSON.stringify(savedOrders));
    }
  }, []);

  const updateOrderStatus = useCallback((orderId: string, status: OrderHistory['status']) => {
    setOrders(prev => prev.map(order => 
      order.id === orderId ? { ...order, status } : order
    ));
    
    // Update localStorage
    if (typeof window !== 'undefined') {
      const savedOrders = JSON.parse(localStorage.getItem('orderHistory') || '[]');
      const updatedOrders = savedOrders.map((order: any) => 
        order.id === orderId ? { ...order, status } : order
      );
      localStorage.setItem('orderHistory', JSON.stringify(updatedOrders));
    }
  }, []);

  const getOrdersBySupplier = useCallback((supplierName: string) => {
    return orders.filter(order => order.supplierName === supplierName);
  }, [orders]);

  const getPendingOrders = useCallback(() => {
    return orders.filter(order => order.status === 'pending');
  }, [orders]);

  const clearHistory = useCallback(() => {
    setOrders([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('orderHistory');
    }
  }, []);

  // Load orders from localStorage on mount
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedOrders = JSON.parse(localStorage.getItem('orderHistory') || '[]');
      setOrders(savedOrders);
    }
  }, []);

  return (
    <OrderHistoryContext.Provider
      value={{
        orders,
        addOrder,
        updateOrderStatus,
        getOrdersBySupplier,
        getPendingOrders,
        clearHistory
      }}
    >
      {children}
    </OrderHistoryContext.Provider>
  );
}

export function useOrderHistory() {
  const context = useContext(OrderHistoryContext);
  if (context === undefined) {
    throw new Error('useOrderHistory must be used within an OrderHistoryProvider');
  }
  return context;
}
