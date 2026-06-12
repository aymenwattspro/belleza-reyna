'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  One-time browser → Supabase migration for ORDERS data.
//
//  Runs ONCE per device (guarded by a localStorage flag), after the user is
//  signed-in AND approved. Moves the legacy IndexedDB (`BellezaReynaOrdersDB`)
//  stores and the `belleza_confirmed_claves` localStorage key into the shared
//  Supabase tables. The local stores are NEVER deleted (they remain the rollback
//  copy). See supabase/ORDERS_DATA_MIGRATION_REPORT.md for the full design.
// ─────────────────────────────────────────────────────────────────────────────

import { ordersDB } from '@/lib/db/orders-db';
import { ordersRepo } from './repos/orders-repo';
import { getSupabaseClient } from './client';

const FLAG = 'belleza_orders_migrated_v1';
const CONFIRMED_KEY = 'belleza_confirmed_claves';

function getFlag(): string | null {
  try {
    return localStorage.getItem(FLAG);
  } catch {
    return null;
  }
}

function setFlag(value: string): void {
  try {
    localStorage.setItem(FLAG, value);
  } catch {
    /* ignore */
  }
}

function readConfirmedClaves(): string[] {
  try {
    const raw = localStorage.getItem(CONFIRMED_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Migrate this device's local Orders data into Supabase exactly once.
 * Safe to call on every load — it self-guards via the run-once flag.
 */
export async function migrateOrdersToSupabaseOnce(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!getSupabaseClient()) return; // Supabase not configured → nothing to do
  if (getFlag()) return; // already started / done / empty on this device

  // 1) Read legacy data from this device.
  let drafts, confirmed, excluded, deselected, confirmedClaves: string[];
  try {
    [drafts, confirmed, excluded, deselected] = await Promise.all([
      ordersDB.getDraftOrders(),
      ordersDB.getConfirmedOrders(),
      ordersDB.getExcludedProducts(),
      ordersDB.getDeselectedClaves(),
    ]);
    confirmedClaves = readConfirmedClaves();
  } catch (e) {
    // Could not read local data — do NOT set the flag, allow a retry next load.
    console.error('[orders-migration] failed reading local data:', e);
    return;
  }

  // 2) Nothing to migrate on this device.
  if (
    drafts.length === 0 &&
    confirmed.length === 0 &&
    excluded.length === 0 &&
    deselected.length === 0 &&
    confirmedClaves.length === 0
  ) {
    setFlag('empty');
    return;
  }

  // 3) Mark started BEFORE writing rows that have no natural key (drafts /
  //    confirmed orders) so a failure cannot cause duplicate rows on re-run.
  setFlag(`started:${new Date().toISOString()}`);

  try {
    // Idempotent (clave-keyed) first.
    await ordersRepo.insertExcluded(excluded);
    await ordersRepo.insertDeselected(deselected);
    await ordersRepo.insertConfirmedClaves(confirmedClaves);

    // Confirmed history — preserve original confirmedAt.
    for (const order of confirmed) {
      await ordersRepo.insertConfirmedOrder(order);
    }

    // Pending drafts — preserve original timestamps; DB assigns new uuids.
    for (const d of drafts) {
      await ordersRepo.createDraft({
        name: d.name,
        supplierName: d.supplierName,
        items: d.items,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      });
    }

    setFlag(`done:${new Date().toISOString()}`);
    console.info('[orders-migration] completed successfully.');
  } catch (e) {
    // Leave the flag as `started` → no automatic retry → no duplicate drafts /
    // confirmed orders. Local IndexedDB/localStorage remain intact (rollback).
    console.error(
      '[orders-migration] failed mid-way. Local data preserved; flag left as "started" to prevent duplicates.',
      e
    );
  }
}
