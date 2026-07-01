import { describe, it, expect } from 'vitest';
import {
  DAY_MS,
  DEFAULT_CONFIG,
  median,
  mad,
  clamp,
  saturate,
  percentileRank,
  reconstructObservations,
  classifyEvents,
  computeDemand,
  computeForecast,
  analyzeProduct,

  analyzeCatalog,
  type Observation,
} from './demand-analytics';

// ── Deterministic weekly grid helpers ─────────────────────────────────────────
const T0 = Date.UTC(2025, 0, 1);
const wk = (n: number) => T0 + n * 7 * DAY_MS;
/** Build a weekly observation series from a list of stock levels. */
const series = (stocks: number[], startWeek = 0): Observation[] =>
  stocks.map((stock, i) => ({ t: wk(startWeek + i), stock }));

// ══════════════════════════════════════════════════════════════════════════════
//  Math primitives
// ══════════════════════════════════════════════════════════════════════════════
describe('math helpers', () => {
  it('median (odd + even)', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('mad', () => {
    expect(mad([1, 1, 1])).toBe(0);
    expect(mad([1, 2, 3, 4, 5])).toBe(1); // deviations 2,1,0,1,2 → median 1
  });

  it('clamp + saturate', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(saturate(0, 3)).toBe(0);
    expect(saturate(3, 3)).toBeCloseTo(0.5, 6);
  });

  it('percentileRank', () => {
    const s = [1, 2, 3, 4];
    expect(percentileRank(s, 4)).toBe(1);
    expect(percentileRank(s, 2)).toBe(0.5);
    expect(percentileRank([], 5)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Step 1 — complete observation grid (keep flat imports)
// ══════════════════════════════════════════════════════════════════════════════
describe('reconstructObservations — carry forward across flat imports', () => {
  it('fills gaps with the last known stock', () => {
    const recorded: Observation[] = [
      { t: wk(0), stock: 100 },
      { t: wk(2), stock: 95 },
      { t: wk(4), stock: 90 },
    ];
    const grid = [wk(0), wk(1), wk(2), wk(3), wk(4)];
    const obs = reconstructObservations(recorded, grid);
    expect(obs.map((o) => o.stock)).toEqual([100, 100, 95, 95, 90]);
  });

  it('ignores grid times before the product first appeared', () => {
    const recorded: Observation[] = [{ t: wk(2), stock: 50 }];
    const grid = [wk(0), wk(1), wk(2), wk(3)];
    const obs = reconstructObservations(recorded, grid);
    expect(obs.map((o) => o.stock)).toEqual([50, 50]); // only wk2, wk3
  });

  it('returns [] for no history', () => {
    expect(reconstructObservations([], [wk(0), wk(1)])).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Scenario A — steady demand
// ══════════════════════════════════════════════════════════════════════════════
describe('Scenario: steady demand (−10/week from 100)', () => {
  const obs = series([100, 90, 80, 70, 60, 50]);
  const now = wk(5);

  it('classifies every interval as normal consumption', () => {
    const ev = classifyEvents(obs);
    expect(ev).toHaveLength(5);
    expect(ev.every((e) => e.type === 'decrease')).toBe(true);
    expect(ev.every((e) => !e.isAnomaly)).toBe(true);
  });

  it('recovers the true daily demand and a stable trend', () => {
    const d = computeDemand(classifyEvents(obs), now);
    expect(d.addDaily).toBeCloseTo(10 / 7, 4);
    expect(d.simpleDaily).toBeCloseTo(10 / 7, 4);
    expect(d.addWeekly).toBeCloseTo(10, 3);
    expect(d.trend).toBe('stable');
    expect(d.anomalyCount).toBe(0);
    expect(d.confidence).toBeGreaterThan(0.5); // dense, long, consistent
  });

  it('forecasts days of cover correctly', () => {
    const a = analyzeProduct(obs, 50, now);
    expect(a.forecast.daysOfCover).toBeCloseTo(35, 3); // 50 / (10/7)
    expect(a.forecast.stockoutDate).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Scenario B — intermittent / flat observations (the 100,100,95,95,90 case)
// ══════════════════════════════════════════════════════════════════════════════
describe('Scenario: intermittent demand with flat imports', () => {
  const obs = series([100, 100, 95, 95, 90]);
  const now = wk(4);

  it('keeps flat intervals as real zero-consumption observations', () => {
    const ev = classifyEvents(obs);
    expect(ev.filter((e) => e.type === 'equal')).toHaveLength(2);
    expect(ev.filter((e) => e.type === 'decrease')).toHaveLength(2);
  });

  it('averages demand across the FULL timeline (flat periods included)', () => {
    const d = computeDemand(classifyEvents(obs), now);
    // 10 units over 28 days = 0.357/day (simple); EWMA slightly higher (recent).
    expect(d.simpleDaily).toBeCloseTo(10 / 28, 4);
    expect(d.validIntervals).toBe(4);
    expect(d.addDaily).toBeGreaterThan(0.3);
    expect(d.addDaily).toBeLessThan(0.55);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Scenario C — no movement
// ══════════════════════════════════════════════════════════════════════════════
describe('Scenario: no movement (flat forever)', () => {
  const obs = series([100, 100, 100, 100]);
  const now = wk(3);

  it('reports zero demand, infinite cover, zero urgency', () => {
    const a = analyzeProduct(obs, 100, now);
    expect(a.events.every((e) => e.type === 'equal')).toBe(true);
    expect(a.demand.addDaily).toBe(0);
    expect(a.forecast.daysOfCover).toBe(Infinity);
    expect(a.priority.urgency).toBe(0);
    expect(a.forecast.stockoutDate).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Scenario D — restock (the algorithm that first-vs-last got WRONG)
// ══════════════════════════════════════════════════════════════════════════════
describe('Scenario: restock 120→80→200→150', () => {
  const obs = series([120, 80, 200, 150]);
  const now = wk(3);

  it('counts both drops as consumption and censors the restock', () => {
    const ev = classifyEvents(obs);
    const restocks = ev.filter((e) => e.type === 'increase' || e.type === 'large_increase');
    expect(restocks).toHaveLength(1);
    expect(restocks[0].sold).toBeNull();

    const soldTotal = ev
      .filter((e) => e.sold !== null)
      .reduce((s, e) => s + (e.sold as number), 0);
    expect(soldTotal).toBe(90); // 40 + 50 — NOT 0 (old first-vs-last bug)
  });

  it('produces a positive, sensible daily demand', () => {
    const d = computeDemand(classifyEvents(obs), now);
    expect(d.addDaily).toBeGreaterThan(5);
    expect(d.addDaily).toBeLessThan(8);
    expect(d.anomalyCount).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Scenario E — inventory correction (large decrease anomaly)
// ══════════════════════════════════════════════════════════════════════════════
describe('Scenario: correction/breakage (large decrease)', () => {
  const obs = series([100, 95, 90, 85, 80, 5]);
  const now = wk(5);

  it('flags the huge drop as an anomaly and excludes it from demand', () => {
    const ev = classifyEvents(obs);
    const last = ev[ev.length - 1];
    expect(last.type).toBe('large_decrease');
    expect(last.sold).toBeNull();

    const d = computeDemand(ev, now);
    // Demand stays ~5/week from the normal drops, NOT inflated by the −75 spike.
    expect(d.addDaily).toBeCloseTo(5 / 7, 2);
    expect(d.anomalyCount).toBeGreaterThanOrEqual(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Scenario F — sparse history (low confidence)
// ══════════════════════════════════════════════════════════════════════════════
describe('Scenario: sparse history', () => {
  it('still estimates demand but with LOW confidence', () => {
    const sparse = analyzeProduct(series([100, 90]), 90, wk(1));
    const steady = analyzeProduct(series([100, 90, 80, 70, 60, 50]), 50, wk(5));
    expect(sparse.demand.validIntervals).toBe(1);
    expect(sparse.demand.addDaily).toBeCloseTo(10 / 7, 4);
    expect(sparse.demand.confidence).toBeLessThan(0.4);
    expect(sparse.demand.confidence).toBeLessThan(steady.demand.confidence);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Scenario G — brand-new product (single observation)
// ══════════════════════════════════════════════════════════════════════════════
describe('Scenario: new product (one observation)', () => {
  it('produces no demand and zero confidence (never spuriously important)', () => {
    const a = analyzeProduct(series([100]), 100, wk(0));
    expect(a.events).toHaveLength(0);
    expect(a.demand.validIntervals).toBe(0);
    expect(a.demand.confidence).toBe(0);
    expect(a.forecast.daysOfCover).toBe(Infinity);
    expect(a.priority.score).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Scenario H — PRIORITY: urgency beats raw popularity
// ══════════════════════════════════════════════════════════════════════════════
describe('Scenario: priority reflects urgency, not just velocity', () => {
  const grid = [wk(0), wk(1), wk(2), wk(3)];
  const now = wk(3);

  // Fast seller but freshly overstocked → low urgency.
  const fast = {
    clave: 'FAST',
    currentStock: 100_000,
    observations: series([200, 150, 100, 50]),
  };
  // Moderate seller almost out of stock → high urgency.
  const mod = {
    clave: 'MOD',
    currentStock: 2,
    observations: series([100, 95, 90, 85]),
  };

  const result = analyzeCatalog([fast, mod], grid, now);
  const byClave = Object.fromEntries(result.map((r) => [r.clave, r]));

  it('ranks the near-stockout product above the well-stocked fast seller', () => {
    expect(byClave.MOD.priority.score).toBeGreaterThan(byClave.FAST.priority.score);
  });

  it('assigns the expected urgency profile', () => {
    expect(byClave.FAST.priority.urgency).toBeCloseTo(0, 3); // tons of cover
    expect(byClave.MOD.priority.urgency).toBeGreaterThan(0.5); // ~2 days cover
  });

  it('still recognizes the fast seller as high velocity (percentile)', () => {
    expect(byClave.FAST.priority.velocityNorm).toBeGreaterThan(byClave.MOD.priority.velocityNorm);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Forecast — safety stock / reorder point wiring
// ══════════════════════════════════════════════════════════════════════════════
describe('Forecast: reorder point uses lead time + safety stock', () => {
  it('reorder point ≈ demand·lead + z·σ·√lead', () => {
    // Variable demand so σ > 0.
    const obs = series([100, 92, 86, 76, 70, 58]); // drops 8,6,10,6,12
    const now = wk(5);
    const d = computeDemand(classifyEvents(obs), now);
    const f = computeForecast(58, d, 7, now); // lead 7d
    expect(d.demandStdDaily).toBeGreaterThan(0);
    const expected = d.addDaily * 7 + DEFAULT_CONFIG.serviceZ * d.demandStdDaily * Math.sqrt(7);
    expect(f.reorderPoint).toBeCloseTo(expected, 6);
    expect(f.safetyStock).toBeGreaterThan(0);
  });

  it('falls back to the global default lead time when none is set', () => {
    const obs = series([100, 90, 80, 70]);
    const now = wk(3);
    const d = computeDemand(classifyEvents(obs), now);
    const f = computeForecast(70, d, 0, now); // 0 → default (7)
    expect(f.reorderPoint).toBeCloseTo(d.addDaily * DEFAULT_CONFIG.defaultLeadTimeDays, 6);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Trend detection
// ══════════════════════════════════════════════════════════════════════════════
describe('Trend detection', () => {
  it('detects rising demand (accelerating drops)', () => {
    const obs = series([200, 198, 195, 190, 180, 165, 145]); // 2,3,5,10,15,20
    const d = computeDemand(classifyEvents(obs), wk(6));
    expect(d.trend).toBe('rising');
    expect(d.trendSlopePerDay).toBeGreaterThan(0);
  });

  it('detects falling demand (decelerating drops)', () => {
    const obs = series([200, 180, 165, 155, 150, 148, 147]); // 20,15,10,5,2,1
    const d = computeDemand(classifyEvents(obs), wk(6));
    expect(d.trend).toBe('falling');
    expect(d.trendSlopePerDay).toBeLessThan(0);
  });
});
