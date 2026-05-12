'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface StockTarget {
  clave: string;
  stockObjetivo: number;
  piezas: number;
  descripcion?: string;
  proveedor?: string;
}

interface StockTargetContextType {
  stockTargets: StockTarget[];
  setStockTargets: (targets: StockTarget[]) => void;
  addStockTargets: (targets: StockTarget[]) => void;
  getStockTarget: (clave: string) => StockTarget | undefined;
  calculateOrderQuantity: (clave: string, currentStock: number) => number;
  clearStockTargets: () => void;
}

const StockTargetContext = createContext<StockTargetContextType | undefined>(undefined);

export function StockTargetProvider({ children }: { children: React.ReactNode }) {
  const [stockTargets, setStockTargets] = useState<StockTarget[]>([]);

  const addStockTargets = useCallback((targets: StockTarget[]) => {
    setStockTargets(prev => {
      // Merge with existing, update if exists
      const newTargets = [...prev];
      targets.forEach(target => {
        const existingIndex = newTargets.findIndex(t => t.clave === target.clave);
        if (existingIndex >= 0) {
          newTargets[existingIndex] = target;
        } else {
          newTargets.push(target);
        }
      });
      return newTargets;
    });

    // Save to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('stockTargets', JSON.stringify(targets));
    }
  }, []);

  const getStockTarget = useCallback((clave: string) => {
    return stockTargets.find(target => target.clave === clave);
  }, [stockTargets]);

  const calculateOrderQuantity = useCallback((clave: string, currentStock: number) => {
    const target = getStockTarget(clave);
    if (!target) return 0;

    const missing = target.stockObjetivo - currentStock;
    if (missing <= 0) return 0;

    // Round up to nearest multiple of piezas
    const piezas = target.piezas || 1;
    return Math.ceil(missing / piezas) * piezas;
  }, [getStockTarget]);

  const clearStockTargets = useCallback(() => {
    setStockTargets([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('stockTargets');
    }
  }, []);

  // Load from localStorage on mount
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('stockTargets');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setStockTargets(parsed);
        } catch (error) {
          console.error('Error loading stock targets:', error);
        }
      }
    }
  }, []);

  return (
    <StockTargetContext.Provider
      value={{
        stockTargets,
        setStockTargets,
        addStockTargets,
        getStockTarget,
        calculateOrderQuantity,
        clearStockTargets
      }}
    >
      {children}
    </StockTargetContext.Provider>
  );
}

export function useStockTarget() {
  const context = useContext(StockTargetContext);
  if (context === undefined) {
    throw new Error('useStockTarget must be used within a StockTargetProvider');
  }
  return context;
}
