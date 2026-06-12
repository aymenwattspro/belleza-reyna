'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { productSettingsRepo } from '@/lib/supabase/repos/product-settings-repo';
import { subscribeTable } from '@/lib/supabase/realtime';
import type { ProductSettings } from '@/lib/db/product-settings-db';

interface ProductSettingsContextType {
  settings: Map<string, ProductSettings>;
  get: (clave: string) => ProductSettings | null;
  getAll: () => ProductSettings[];
  save: (settings: ProductSettings) => Promise<void>;
  loading: boolean;
}

const ProductSettingsContext = createContext<ProductSettingsContextType | undefined>(undefined);

export function ProductSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Map<string, ProductSettings>>(new Map());
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const all = await productSettingsRepo.getAll();
      setSettings(new Map(all.map((s) => [s.clave, s])));
    } catch (e) {
      console.error('ProductSettingsContext refresh error:', e);
    }
  }, []);

  // Initial load
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        await refresh();
      } catch (e) {
        console.error('ProductSettingsContext init error:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [refresh]);

  // Realtime: re-fetch whenever any user changes shared product settings
  useEffect(() => subscribeTable('product_settings', refresh), [refresh]);

  const get = useCallback(
    (clave: string): ProductSettings | null => settings.get(clave) || null,
    [settings]
  );

  const getAll = useCallback((): ProductSettings[] => Array.from(settings.values()), [settings]);

  const save = useCallback(async (newSettings: ProductSettings) => {
    await productSettingsRepo.save(newSettings);
    // Optimistic local update; Realtime will reconcile across clients.
    setSettings((prev) => {
      const next = new Map(prev);
      next.set(newSettings.clave, { ...newSettings, updatedAt: new Date().toISOString() });
      return next;
    });
  }, []);

  return (
    <ProductSettingsContext.Provider value={{ settings, get, getAll, save, loading }}>
      {children}
    </ProductSettingsContext.Provider>
  );
}

export function useProductSettings() {
  const ctx = useContext(ProductSettingsContext);
  if (!ctx) throw new Error('useProductSettings must be used within ProductSettingsProvider');
  return ctx;
}
