'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  Suppliers repository — Supabase data access (shared workspace)
//  Maps the DB's snake_case rows to the app's camelCase `Supplier` shape so the
//  rest of the app (SupplierContext + pages) is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseClient } from '../client';
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

interface SupplierRow {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toSupplier(r: SupplierRow): Supplier {
  return {
    id: r.id,
    name: r.name,
    contactPerson: r.contact_person ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    address: r.address ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toRow(input: SupplierInput) {
  const clean = (v?: string) => {
    const t = (v ?? '').trim();
    return t.length ? t : null;
  };
  return {
    name: (input.name ?? '').trim(),
    contact_person: clean(input.contactPerson),
    phone: clean(input.phone),
    email: clean(input.email),
    address: clean(input.address),
    notes: clean(input.notes),
  };
}

/** Thrown when a unique-name conflict (or any DB error) occurs. */
export class SupplierConflictError extends Error {}

export const suppliersRepo = {
  /** True when Supabase is configured (used by the context to decide behavior). */
  isAvailable(): boolean {
    return getSupabaseClient() != null;
  },

  async getAll(): Promise<Supplier[]> {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data as SupplierRow[]).map(toSupplier);
  },

  /** Insert a new supplier. Throws SupplierConflictError on duplicate name. */
  async create(input: SupplierInput): Promise<Supplier> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('suppliers')
      .insert(toRow(input))
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') throw new SupplierConflictError(error.message);
      throw error;
    }
    return toSupplier(data as SupplierRow);
  },

  /** Update an existing supplier. Throws SupplierConflictError on duplicate name. */
  async update(id: string, input: SupplierInput): Promise<Supplier> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('suppliers')
      .update(toRow(input))
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') throw new SupplierConflictError(error.message);
      throw error;
    }
    return toSupplier(data as SupplierRow);
  },

  async remove(id: string): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) throw error;
  },
};
