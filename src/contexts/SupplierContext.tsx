'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { suppliersDB, Supplier } from '@/lib/db/suppliers-db';

export type { Supplier } from '@/lib/db/suppliers-db';

export interface SupplierInput {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

interface SupplierContextType {
  suppliers: Supplier[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Create a supplier. Returns the created record, or null if the name is a duplicate / empty. */
  addSupplier: (input: SupplierInput) => Promise<Supplier | null>;
  /** Create a supplier from just a name (used to quick-add inventory suppliers). */
  addSupplierByName: (name: string) => Promise<Supplier | null>;
  updateSupplier: (id: string, input: SupplierInput) => Promise<boolean>;
  deleteSupplier: (id: string) => Promise<void>;
  findByName: (name: string) => Supplier | null;
}

const SupplierContext = createContext<SupplierContextType | undefined>(undefined);

export function SupplierProvider({ children }: { children: React.ReactNode }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const all = await suppliersDB.getAll();
      setSuppliers(all);
    } catch (e) {
      console.error('SupplierContext refresh error:', e);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        await suppliersDB.init();
        await refresh();
      } catch (e) {
        console.error('SupplierContext init error:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [refresh]);

  const nameExists = useCallback(
    (name: string, exceptId?: string) => {
      const normalized = name.trim().toLowerCase();
      return suppliers.some(
        (s) => s.id !== exceptId && s.name.trim().toLowerCase() === normalized
      );
    },
    [suppliers]
  );

  const addSupplier = useCallback(
    async (input: SupplierInput): Promise<Supplier | null> => {
      const name = (input.name || '').trim();
      if (!name) return null;
      if (nameExists(name)) return null;

      const now = new Date().toISOString();
      const supplier: Supplier = {
        id: `sup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        contactPerson: input.contactPerson?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        email: input.email?.trim() || undefined,
        address: input.address?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      };
      await suppliersDB.save(supplier);
      await refresh();
      return supplier;
    },
    [nameExists, refresh]
  );

  const addSupplierByName = useCallback(
    async (name: string): Promise<Supplier | null> => {
      return addSupplier({ name });
    },
    [addSupplier]
  );

  const updateSupplier = useCallback(
    async (id: string, input: SupplierInput): Promise<boolean> => {
      const name = (input.name || '').trim();
      if (!name) return false;
      if (nameExists(name, id)) return false;

      const existing = await suppliersDB.get(id);
      if (!existing) return false;

      const updated: Supplier = {
        ...existing,
        name,
        contactPerson: input.contactPerson?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        email: input.email?.trim() || undefined,
        address: input.address?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        updatedAt: new Date().toISOString(),
      };
      await suppliersDB.save(updated);
      await refresh();
      return true;
    },
    [nameExists, refresh]
  );

  const deleteSupplier = useCallback(
    async (id: string) => {
      await suppliersDB.delete(id);
      await refresh();
    },
    [refresh]
  );

  const findByName = useCallback(
    (name: string): Supplier | null => {
      const normalized = name.trim().toLowerCase();
      return suppliers.find((s) => s.name.trim().toLowerCase() === normalized) || null;
    },
    [suppliers]
  );

  return (
    <SupplierContext.Provider
      value={{
        suppliers,
        loading,
        refresh,
        addSupplier,
        addSupplierByName,
        updateSupplier,
        deleteSupplier,
        findByName,
      }}
    >
      {children}
    </SupplierContext.Provider>
  );
}

export function useSuppliers() {
  const ctx = useContext(SupplierContext);
  if (!ctx) throw new Error('useSuppliers must be used within a SupplierProvider');
  return ctx;
}
