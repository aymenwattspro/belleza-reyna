'use client';

import { useEffect, useMemo } from 'react';
import { useInventory } from '@/contexts/InventoryContext';
import { useProductSettings } from '@/contexts/ProductSettingsContext';
import { useOrder } from '@/contexts/OrderContext';

/**
 * LiveOrderSync — keeps the live "Total Order" list (OrderContext.orderLines)
 * continuously built from the latest inventory snapshot + product settings,
 * REGARDLESS of which page is currently mounted.
 *
 * Why this exists:
 *   The order list was previously built ONLY by an effect on the Home
 *   (inventory-hub) page. So a hard refresh while on /orders or /draft-orders
 *   showed an empty list until the user navigated to Home and back (which is the
 *   exact symptom reported: "products disappear on refresh until I click Home").
 *
 * This component renders nothing. It is mounted once in the app shell (inside all
 * the providers) so the build effect always runs. It mirrors the Home page's
 * settingsMap + buildOrderFromSnapshot call EXACTLY, so the resulting order count
 * is identical no matter where the build happens.
 */
export function LiveOrderSync() {
  const { latestSnapshot, loading } = useInventory();
  const { getAll: getAllSettings } = useProductSettings();
  const { buildOrderFromSnapshot } = useOrder();

  // Same mapping the Home page uses: clave → { minStockUnits, piezas }.
  const settingsMap = useMemo(() => {
    const all = getAllSettings();
    const map = new Map<string, { minStockUnits: number; piezas?: number }>();
    for (const s of all) map.set(s.clave, { minStockUnits: s.minStockUnits, piezas: s.minStockCases });
    return map;
  }, [getAllSettings]);

  useEffect(() => {
    if (latestSnapshot) {
      buildOrderFromSnapshot(latestSnapshot.products, settingsMap, latestSnapshot.id);
    } else if (!loading) {
      buildOrderFromSnapshot([], settingsMap);
    }
  }, [latestSnapshot, settingsMap, loading, buildOrderFromSnapshot]);

  return null;
}
