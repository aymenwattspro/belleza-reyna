import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
// Always evaluate per-request — the response depends on request headers (IP/geo).
export const dynamic = 'force-dynamic';

/**
 * GET /api/audit/context
 *
 * Returns the server-observed network context for the current request:
 *   { ip, geo: { country, region, city, timezone, latitude, longitude } }
 *
 * The client merges this into the audit-context it sends to `log_audit`, so every
 * new activity record can carry trustworthy (server-side) IP + coarse location.
 *
 * Source of truth:
 *   • IP   → x-forwarded-for / x-real-ip (set by Vercel / the platform proxy).
 *   • Geo  → Vercel's edge geo headers (x-vercel-ip-*). These are derived from the
 *            IP by the platform — no third-party geolocation call, no extra
 *            dependency, and nothing is persisted here. If the app is not deployed
 *            on Vercel (e.g. local dev) these headers are absent and we return
 *            nulls — we never fabricate a location.
 */
export async function GET(req: NextRequest) {
  const h = req.headers;

  const firstForwarded = (h.get('x-forwarded-for') ?? '').split(',')[0].trim();
  const ip = firstForwarded || h.get('x-real-ip') || null;

  const decode = (v: string | null): string | null => {
    if (!v) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };

  const num = (v: string | null): number | null => {
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const country = h.get('x-vercel-ip-country');
  const region = h.get('x-vercel-ip-country-region');
  const city = decode(h.get('x-vercel-ip-city'));
  const timezone = h.get('x-vercel-ip-timezone');
  const latitude = num(h.get('x-vercel-ip-latitude'));
  const longitude = num(h.get('x-vercel-ip-longitude'));

  // Only expose a geo object when at least one field is actually present.
  const hasGeo = country || region || city || timezone || latitude != null || longitude != null;
  const geo = hasGeo
    ? { country, region, city, timezone, latitude, longitude }
    : null;

  return Response.json(
    { ip, geo },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
