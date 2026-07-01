// ─────────────────────────────────────────────────────────────────────────────
//  Belleza Reyna — Canonical Demand & Priority Analytics Engine
//
//  ONE source of truth for all behaviour/demand math. Pure, deterministic and
//  dependency-free so it can be unit-tested exhaustively and reused by every
//  screen (dashboard, orders, product, suppliers, behaviour view, timeline).
//
//  Pipeline (each step is explainable and independently inspectable):
//
//     Inventory Snapshots            reconstructObservations()  ← keep FLAT imports
//        → Inventory Events          classifyEvents()           ← decrease/equal/increase/anomaly
//        → Consumption Events        (sold / dailyRate per interval, restocks censored)
//        → Demand Metrics            computeDemand()            ← EWMA ADD, MA7/30, EMA, trend, confidence
//        → Priority Score            computePriority()          ← demand × urgency × confidence × trend
//        → Suggested Order / Forecast computeForecast()         ← DoC, stockout, safety stock, ROP
//
//  Design notes
//  • Time is injected (`nowT`) everywhere so tests are deterministic.
//  • Restocks and corrections are CLASSIFIED, not silently dropped — they are
//    excluded from the demand RATE (censored) but retained for business insight.
//  • Flat ("equal") intervals ARE kept and count as real zero-consumption
//    observations, exactly as required (an unchanged import is information).
//  • No arbitrary 0-100 scaling of velocity: priority uses catalog percentile.
// ─────────────────────────────────────────────────────────────────────────────

export const DAY_MS = 86_400_000;
const EPS = 1e-9;
// MAD → σ consistency factor for a normal distribution.
const MAD_SCALE = 1.4826;

// ── Public types ──────────────────────────────────────────────────────────────

/** A single stock observation at a point in time. */
export interface Observation {
  /** Epoch milliseconds of the import. */
  t: number;
  /** `existencia` (stock on hand) at that import. */
  stock: number;
}

export type EventType =
  | 'decrease'        // normal consumption
  | 'equal'           // no measurable movement (kept — real information)
  | 'increase'        // restock / replenishment
  | 'large_decrease'  // anomaly: correction / breakage / transfer
  | 'large_increase'; // anomaly: bulk restock / correction

/** One interval between two consecutive observations, classified + measured. */
export interface IntervalEvent {
  fromT: number;
  toT: number;
  fromStock: number;
  toStock: number;
  /** Elapsed days (>= tiny epsilon, never 0). */
  days: number;
  /** toStock − fromStock (negative = sold, positive = restock). */
  delta: number;
  type: EventType;
  isAnomaly: boolean;
  /** Units attributed to consumption for this interval, or null when censored. */
  sold: number | null;
  /** sold / days, or null when censored (restock / anomaly). */
  dailyRate: number | null;
}

export interface DemandConfig {
  /** EWMA half-life in days (recent demand weighted more). */
  halfLifeDays: number;
  /** Target days of stock cover used to scale urgency. */
  coverTargetDays: number;
  /** Fallback lead time when a supplier has none configured. */
  defaultLeadTimeDays: number;
  /** MAD multiplier for outlier / "large move" detection. */
  madK: number;
  /** A single-step move above this fraction of prior stock is "large". */
  largeMovePctOfStock: number;
  /** z-value for safety stock (1.64 ≈ 95% service level). */
  serviceZ: number;
  /** Saturation constant for the observation-count confidence term. */
  confidenceNK: number;
  /** Saturation constant for the history-span confidence term (days). */
  confidenceSpanK: number;
  /** Floor used when expressing a move as a fraction of prior stock. */
  minStockForPct: number;
}

export const DEFAULT_CONFIG: DemandConfig = {
  halfLifeDays: 30,
  coverTargetDays: 14,
  defaultLeadTimeDays: 7,
  madK: 3.5,
  largeMovePctOfStock: 0.8,
  serviceZ: 1.64,
  confidenceNK: 3,
  confidenceSpanK: 14,
  minStockForPct: 1,
};

export interface DemandMetrics {
  /** Average daily demand — recency-weighted (EWMA). The headline number. */
  addDaily: number;
  /** addDaily × 7. */
  addWeekly: number;
  /** Total sold / total valid days (plain, un-weighted reference). */
  simpleDaily: number;
  /** Trailing 7-day average daily demand (null if no data in the window). */
  ma7: number | null;
  /** Trailing 30-day average daily demand (null if no data in the window). */
  ma30: number | null;
  /** Iterative exponential moving average of interval rates. */
  ema: number;
  trend: 'rising' | 'stable' | 'falling';
  /** Least-squares slope of rate vs time (units/day per day). */
  trendSlopePerDay: number;
  /** 0..1 reliability of the estimate (rewards long, dense, consistent history). */
  confidence: number;
  /** MAD/median of the rate samples (robust coefficient of variation). */
  dispersion: number;
  /** Standard deviation of daily rate (for safety stock). */
  demandStdDaily: number;
  validIntervals: number;
  anomalyCount: number;
  totalIntervals: number;
  /** The (winsorized) rate samples actually used. */
  sampleRates: number[];
}

export interface Forecast {
  /** current_stock / addDaily; Infinity when there is no measurable demand. */
  daysOfCover: number;
  /** Epoch ms when stock is projected to hit 0, or null if no demand. */
  stockoutDate: number | null;
  safetyStock: number;
  reorderPoint: number;
  /** Days until stock reaches the reorder point (≤0 = overdue, Infinity = never). */
  daysUntilReorder: number;
  /** Epoch ms of the recommended reorder date, or null if no demand. */
  reorderDate: number | null;
  forecastConfidence: number;
}

export interface Priority {
  /** 0..100 composite ordering priority. */
  score: number;
  /** 0..1 — how close to stockout relative to the cover target. */
  urgency: number;
  /** 0..1 — catalog percentile of demand velocity. */
  velocityNorm: number;
  /** 0..1 — trend contribution (rising=1, stable=0.5, falling=0). */
  trendComponent: number;
  /** 0..1 — data reliability (multiplies the score). */
  confidence: number;
}

// ── Small, tested math helpers ────────────────────────────────────────────────

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation (robust dispersion). */
export function mad(xs: number[], center?: number): number {
  if (xs.length === 0) return 0;
  const c = center ?? median(xs);
  return median(xs.map((x) => Math.abs(x - c)));
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** x/(x+k) — smooth 0→1 saturation. */
export function saturate(x: number, k: number): number {
  return x <= 0 ? 0 : x / (x + k);
}

/** Fraction of `sortedAsc` values ≤ `value` (0..1). */
export function percentileRank(sortedAsc: number[], value: number): number {
  if (sortedAsc.length === 0) return 0;
  let count = 0;
  for (const v of sortedAsc) {
    if (v <= value) count++;
    else break;
  }
  return count / sortedAsc.length;
}

// ── Step 1 — reconstruct the complete observation grid ────────────────────────

/**
 * Rebuild a value for a product at EVERY import time (from first-seen onward),
 * carrying forward the last known stock across imports where it did not change.
 *
 * This is what makes flat imports count: `stock_history` only stores changes,
 * so `recorded` may be sparse; the returned series is dense over the real grid.
 */
export function reconstructObservations(
  recorded: Observation[],
  gridTimes: number[],
): Observation[] {
  if (recorded.length === 0) return [];
  const rec = [...recorded].sort((a, b) => a.t - b.t);
  const firstT = rec[0].t;
  const times = Array.from(new Set([...gridTimes, ...rec.map((r) => r.t)])).sort(
    (a, b) => a - b,
  );

  const out: Observation[] = [];
  let idx = 0;
  let lastStock = rec[0].stock;
  for (const t of times) {
    if (t < firstT) continue; // product did not exist yet
    while (idx < rec.length && rec[idx].t <= t) {
      lastStock = rec[idx].stock;
      idx++;
    }
    out.push({ t, stock: lastStock });
  }
  return out;
}

// ── Step 2 — classify every interval ──────────────────────────────────────────

export function classifyEvents(
  observations: Observation[],
  config: DemandConfig = DEFAULT_CONFIG,
): IntervalEvent[] {
  const o = [...observations].sort((a, b) => a.t - b.t);
  if (o.length < 2) return [];

  const raw = [];
  for (let i = 1; i < o.length; i++) {
    const days = Math.max(EPS, (o[i].t - o[i - 1].t) / DAY_MS);
    raw.push({
      fromT: o[i - 1].t,
      toT: o[i].t,
      fromStock: o[i - 1].stock,
      toStock: o[i].stock,
      days,
      delta: o[i].stock - o[i - 1].stock,
    });
  }

  // Robust "large move" threshold from the magnitudes of all non-zero moves.
  const moves = raw.map((r) => Math.abs(r.delta)).filter((d) => d > 0);
  const med = median(moves);
  const robustUpper = med + config.madK * (mad(moves, med) * MAD_SCALE);
  const haveRobust = moves.length >= 4 && robustUpper > 0;

  return raw.map((r) => {
    const absDelta = Math.abs(r.delta);
    const pctOfStock = absDelta / Math.max(config.minStockForPct, r.fromStock);
    const isLarge =
      (haveRobust && absDelta > robustUpper) ||
      pctOfStock > config.largeMovePctOfStock;

    let type: EventType;
    let sold: number | null;
    let dailyRate: number | null;

    if (r.delta === 0) {
      type = 'equal';
      sold = 0;
      dailyRate = 0;
    } else if (r.delta < 0) {
      if (isLarge) {
        type = 'large_decrease';
        sold = null;
        dailyRate = null;
      } else {
        type = 'decrease';
        sold = absDelta;
        dailyRate = absDelta / r.days;
      }
    } else {
      type = isLarge ? 'large_increase' : 'increase';
      sold = null;
      dailyRate = null;
    }

    return { ...r, type, isAnomaly: isLarge, sold, dailyRate };
  });
}

// ── Step 3+4 — demand metrics ─────────────────────────────────────────────────

interface ValidSample {
  rate: number;
  days: number;
  midT: number;
  sold: number;
  fromT: number;
  toT: number;
}

function emptyDemand(events: IntervalEvent[]): DemandMetrics {
  return {
    addDaily: 0,
    addWeekly: 0,
    simpleDaily: 0,
    ma7: null,
    ma30: null,
    ema: 0,
    trend: 'stable',
    trendSlopePerDay: 0,
    confidence: 0,
    dispersion: 0,
    demandStdDaily: 0,
    validIntervals: 0,
    anomalyCount: events.filter((e) => e.isAnomaly).length,
    totalIntervals: events.length,
    sampleRates: [],
  };
}

function windowedDaily(valid: ValidSample[], nowT: number, windowDays: number): number | null {
  const start = nowT - windowDays * DAY_MS;
  let sold = 0;
  let overlapDays = 0;
  for (const v of valid) {
    const a = Math.max(v.fromT, start);
    const b = Math.min(v.toT, nowT);
    if (b <= a) continue;
    const ov = (b - a) / DAY_MS;
    sold += v.sold * (ov / v.days);
    overlapDays += ov;
  }
  if (overlapDays <= 0) return null;
  return sold / windowDays;
}

export function computeDemand(
  events: IntervalEvent[],
  nowT: number,
  config: DemandConfig = DEFAULT_CONFIG,
): DemandMetrics {
  const anomalyCount = events.filter((e) => e.isAnomaly).length;
  const totalIntervals = events.length;

  // Valid = intervals with a measurable rate (decrease + equal). Restocks and
  // anomalies are censored (dailyRate === null) and excluded from the estimate.
  const valid: ValidSample[] = events
    .filter((e) => e.dailyRate !== null)
    .map((e) => ({
      rate: e.dailyRate as number,
      days: e.days,
      midT: (e.fromT + e.toT) / 2,
      sold: (e.sold as number) ?? 0,
      fromT: e.fromT,
      toT: e.toT,
    }));

  if (valid.length === 0) return emptyDemand(events);

  const rawRates = valid.map((v) => v.rate);

  // Winsorize upper outliers (robust) before aggregating.
  const med = median(rawRates);
  const m = mad(rawRates, med);
  const upper = m > 0 ? med + config.madK * (m * MAD_SCALE) : Math.max(...rawRates);
  const wins = rawRates.map((r) => clamp(r, 0, upper > 0 ? upper : r));

  // EWMA average daily demand (recency-weighted, exposure-weighted by days).
  const tau = config.halfLifeDays / Math.LN2;
  let wSum = 0;
  let wRate = 0;
  valid.forEach((v, i) => {
    const ageDays = Math.max(0, (nowT - v.midT) / DAY_MS);
    const w = v.days * Math.exp(-ageDays / tau);
    wSum += w;
    wRate += wins[i] * w;
  });
  const addDaily = wSum > 0 ? wRate / wSum : 0;

  // Plain reference: total sold / total valid days.
  const totalSold = valid.reduce((a, v) => a + v.sold, 0);
  const totalDays = valid.reduce((a, v) => a + v.days, 0);
  const simpleDaily = totalDays > 0 ? totalSold / totalDays : 0;

  // Trailing moving averages.
  const ma7 = windowedDaily(valid, nowT, 7);
  const ma30 = windowedDaily(valid, nowT, 30);

  // Iterative EMA over chronological interval rates.
  const chrono = valid.map((v, i) => ({ midT: v.midT, days: v.days, rate: wins[i] }))
    .sort((a, b) => a.midT - b.midT);
  let ema = chrono[0].rate;
  for (let i = 1; i < chrono.length; i++) {
    const alpha = 1 - Math.exp(-chrono[i].days / tau);
    ema = ema + alpha * (chrono[i].rate - ema);
  }

  // Trend: split by time into older vs recent halves.
  let trend: DemandMetrics['trend'] = 'stable';
  if (chrono.length >= 3) {
    const half = Math.floor(chrono.length / 2);
    const olderMean = mean(chrono.slice(0, half).map((c) => c.rate));
    const recentMean = mean(chrono.slice(chrono.length - half).map((c) => c.rate));
    if (olderMean <= EPS && recentMean > EPS) trend = 'rising';
    else if (recentMean > olderMean * 1.15) trend = 'rising';
    else if (recentMean < olderMean * 0.85) trend = 'falling';
  }

  // Least-squares slope of rate vs time (days from first sample).
  const firstMid = chrono[0].midT;
  const xs = chrono.map((c) => (c.midT - firstMid) / DAY_MS);
  const ys = chrono.map((c) => c.rate);
  const xBar = mean(xs);
  const yBar = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - xBar) * (ys[i] - yBar);
    den += (xs[i] - xBar) * (xs[i] - xBar);
  }
  const trendSlopePerDay = den > EPS ? num / den : 0;

  // Dispersion + confidence.
  const dispersion = med > EPS ? m / med : m > EPS ? 1 : 0;
  const demandStdDaily = stddev(wins);
  const spanDays = (valid[valid.length - 1].toT - valid[0].fromT) / DAY_MS;
  const countFactor = saturate(valid.length, config.confidenceNK);
  const spanFactor = saturate(spanDays, config.confidenceSpanK);
  const consistencyFactor = 1 - clamp(dispersion, 0, 1) * 0.6; // [0.4, 1]
  const anomalyFactor = 1 - 0.5 * (totalIntervals > 0 ? anomalyCount / totalIntervals : 0);
  const confidence = clamp(
    (0.5 * countFactor + 0.5 * spanFactor) * consistencyFactor * anomalyFactor,
    0,
    1,
  );

  return {
    addDaily,
    addWeekly: addDaily * 7,
    simpleDaily,
    ma7,
    ma30,
    ema,
    trend,
    trendSlopePerDay,
    confidence,
    dispersion,
    demandStdDaily,
    validIntervals: valid.length,
    anomalyCount,
    totalIntervals,
    sampleRates: wins,
  };
}

// ── Step 5 — forecast (stockout, safety stock, reorder point/date) ────────────

export function computeForecast(
  currentStock: number,
  demand: DemandMetrics,
  leadTimeDays: number,
  nowT: number,
  config: DemandConfig = DEFAULT_CONFIG,
): Forecast {
  const add = demand.addDaily;
  const daysOfCover = add > EPS ? currentStock / add : Infinity;
  const stockoutDate = add > EPS ? nowT + daysOfCover * DAY_MS : null;

  const lead = leadTimeDays > 0 ? leadTimeDays : config.defaultLeadTimeDays;
  const safetyStock = config.serviceZ * demand.demandStdDaily * Math.sqrt(lead);
  const reorderPoint = add * lead + safetyStock;

  const daysUntilReorder = add > EPS ? (currentStock - reorderPoint) / add : Infinity;
  const reorderDate =
    add > EPS ? nowT + Math.max(0, daysUntilReorder) * DAY_MS : null;

  return {
    daysOfCover,
    stockoutDate,
    safetyStock,
    reorderPoint,
    daysUntilReorder,
    reorderDate,
    forecastConfidence: demand.confidence,
  };
}

// ── Step 6 — priority (demand × urgency × confidence × trend) ─────────────────

export function computePriority(
  demand: DemandMetrics,
  forecast: Forecast,
  velocityNorm: number,
  config: DemandConfig = DEFAULT_CONFIG,
): Priority {
  const urgency = clamp(1 - forecast.daysOfCover / config.coverTargetDays, 0, 1);
  const trendComponent = demand.trend === 'rising' ? 1 : demand.trend === 'falling' ? 0 : 0.5;
  const score =
    100 *
    demand.confidence *
    (0.5 * urgency + 0.35 * clamp(velocityNorm, 0, 1) + 0.15 * trendComponent);

  return {
    score,
    urgency,
    velocityNorm: clamp(velocityNorm, 0, 1),
    trendComponent,
    confidence: demand.confidence,
  };
}

// ── Catalog-level orchestration ───────────────────────────────────────────────

export interface ProductInput {
  clave: string;
  currentStock: number;
  /** Per-supplier lead time; falls back to config.defaultLeadTimeDays. */
  leadTimeDays?: number;
  /** Preferred: complete observation grid for this product. */
  observations?: Observation[];
  /** Alternative: sparse change-points; reconstructed against `gridTimes`. */
  recordedPoints?: Observation[];
}

export interface ProductAnalytics {
  clave: string;
  events: IntervalEvent[];
  demand: DemandMetrics;
  forecast: Forecast;
  priority: Priority;
}

/**
 * Analyze a whole catalog in one pass. Velocity is normalized as a percentile
 * across the catalog's own demand distribution (no arbitrary constants), then
 * folded into each product's priority.
 */
export function analyzeCatalog(
  products: ProductInput[],
  gridTimes: number[],
  nowT: number,
  config: DemandConfig = DEFAULT_CONFIG,
): ProductAnalytics[] {
  // Pass 1: demand + forecast.
  const stage = products.map((p) => {
    const obs = p.observations ?? reconstructObservations(p.recordedPoints ?? [], gridTimes);
    const events = classifyEvents(obs, config);
    const demand = computeDemand(events, nowT, config);
    const lead = p.leadTimeDays && p.leadTimeDays > 0 ? p.leadTimeDays : config.defaultLeadTimeDays;
    const forecast = computeForecast(p.currentStock, demand, lead, nowT, config);
    return { clave: p.clave, events, demand, forecast };
  });

  // Percentile basis: the positive demand values across the catalog.
  const positiveAdds = stage
    .map((s) => s.demand.addDaily)
    .filter((a) => a > EPS)
    .sort((a, b) => a - b);

  // Pass 2: priority (needs the catalog-wide velocity distribution).
  return stage.map((s) => {
    const velocityNorm = s.demand.addDaily > EPS ? percentileRank(positiveAdds, s.demand.addDaily) : 0;
    const priority = computePriority(s.demand, s.forecast, velocityNorm, config);
    return { ...s, priority };
  });
}

/** Convenience: full analytics for a single product's observation series. */
export function analyzeProduct(
  observations: Observation[],
  currentStock: number,
  nowT: number,
  leadTimeDays: number = DEFAULT_CONFIG.defaultLeadTimeDays,
  config: DemandConfig = DEFAULT_CONFIG,
): Omit<ProductAnalytics, 'clave' | 'priority'> & { priority: Priority } {
  const events = classifyEvents(observations, config);
  const demand = computeDemand(events, nowT, config);
  const forecast = computeForecast(currentStock, demand, leadTimeDays, nowT, config);
  // Single-product velocity percentile is undefined; use a neutral 0.5 so the
  // urgency/confidence terms still dominate. Catalog callers use analyzeCatalog.
  const priority = computePriority(demand, forecast, 0.5, config);
  return { events, demand, forecast, priority };
}
