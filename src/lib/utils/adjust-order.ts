/**
 * Exact ordering formula from Belleza Reyna specification.
 * Rounds to the nearest case multiple, with a 50% threshold to avoid
 * ordering less than half a case.
 */
export function adjustOrder(baseOrder: number, unitsPerCase: number): number {
  if (
    !isFinite(baseOrder) ||
    !isFinite(unitsPerCase) ||
    isNaN(baseOrder) ||
    isNaN(unitsPerCase) ||
    unitsPerCase <= 0
  ) {
    return 0;
  }

  if (baseOrder <= 0) return 0;

  // Threshold: If order is less than 50% of a case, do not order
  if (baseOrder < unitsPerCase / 2) {
    return 0;
  }

  const lowerMultiple = Math.floor(baseOrder / unitsPerCase) * unitsPerCase;
  const upperMultiple = lowerMultiple + unitsPerCase;

  // Round to the nearest multiple
  if ((baseOrder - lowerMultiple) < (upperMultiple - baseOrder)) {
    return lowerMultiple === 0 ? upperMultiple : lowerMultiple;
  } else {
    return upperMultiple;
  }
}

/**
 * Traffic-light stock status — relative to target stock.
 *
 * 🔴 Red:    stock == 0  OR  stock ≤ target × 0.20
 * 🟠 Orange: stock > target × 0.20  AND  stock < target × 0.70
 * 🟢 Green:  stock ≥ target × 0.70
 *
 * When no target is set (target ≤ 0), falls back to:
 *   🔴 stock == 0,  🟢 otherwise.
 */
export function getStockStatus(
  currentStock: number,
  targetStock: number,
): 'red' | 'orange' | 'green' {
  if (targetStock <= 0) {
    return currentStock <= 0 ? 'red' : 'green';
  }
  if (currentStock <= 0 || currentStock <= targetStock * 0.20) return 'red';
  if (currentStock < targetStock * 0.70) return 'orange';
  return 'green';
}

/**
 * Returns Tailwind classes for the traffic-light status.
 */
export function getStatusClasses(status: 'red' | 'orange' | 'green') {
  switch (status) {
    case 'red':
      return { dot: 'bg-red-500', badge: 'bg-red-100 text-red-700', label: 'Out of Stock', text: 'text-red-600' };
    case 'orange':
      return { dot: 'bg-orange-400', badge: 'bg-orange-100 text-orange-700', label: 'Low Stock', text: 'text-orange-500' };
    case 'green':
      return { dot: 'bg-green-500', badge: 'bg-green-100 text-green-700', label: 'In Stock', text: 'text-emerald-600' };
  }
}
