'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { suppliersRepo, SupplierConflictError } from '@/lib/supabase/repos/suppliers-repo';
import { subscribeTable } from '@/lib/supabase/realtime';
import { supplierKey } from '@/lib/utils/supplier';
import type { Supplier } from '@/lib/db/suppliers-db';


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
      const all = await suppliersRepo.getAll();
      setSuppliers(all);
    } catch (e) {
      console.error('SupplierContext refresh error:', e);
    }
  }, []);

  // Initial load
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        await refresh();
      } catch (e) {
        console.error('SupplierContext init error:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [refresh]);

  // Realtime: re-fetch whenever any user changes the shared suppliers table
  useEffect(() => subscribeTable('suppliers', refresh), [refresh]);

  // Compare by canonical key so "Beauty System", "beauty system " and
  // "BEAUTY  SYSTEM" all count as the same supplier — preventing duplicate
  // records that would later split a supplier's products across two pages.
  const nameExists = useCallback(
    (name: string, exceptId?: string) => {
      const key = supplierKey(name);
      return suppliers.some(
        (s) => s.id !== exceptId && supplierKey(s.name) === key
      );
    },
    [suppliers]
  );


  const addSupplier = useCallback(
    async (input: SupplierInput): Promise<Supplier | null> => {
      const name = (input.name || '').trim();
      if (!name) return null;
      if (nameExists(name)) return null; // fast client-side guard

      try {
        const supplier = await suppliersRepo.create({ ...input, name });
        // Optimistic local update; Realtime will reconcile across clients.
        setSuppliers((prev) =>
          [...prev.filter((s) => s.id !== supplier.id), supplier].sort((a, b) =>
            a.name.localeCompare(b.name)
          )
        );
        return supplier;
      } catch (e) {
        if (e instanceof SupplierConflictError) return null; // DB unique-name guard
        console.error('addSupplier error:', e);
        return null;
      }
    },
    [nameExists]
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

      try {
        const updated = await suppliersRepo.update(id, { ...input, name });
        setSuppliers((prev) =>
          prev.map((s) => (s.id === id ? updated : s)).sort((a, b) =>
            a.name.localeCompare(b.name)
          )
        );
        return true;
      } catch (e) {
        if (e instanceof SupplierConflictError) return false;
        console.error('updateSupplier error:', e);
        return false;
      }
    },
    [nameExists]
  );

  const deleteSupplier = useCallback(
    async (id: string) => {
      try {
        await suppliersRepo.remove(id);
        setSuppliers((prev) => prev.filter((s) => s.id !== id));
      } catch (e) {
        console.error('deleteSupplier error:', e);
      }
    },
    []
  );

  const findByName = useCallback(
    (name: string): Supplier | null => {
      const key = supplierKey(name);
      return suppliers.find((s) => supplierKey(s.name) === key) || null;
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
