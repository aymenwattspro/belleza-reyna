'use client';

/**
 * Client-side audit context collection.
 *
 * Produces the `p_context` object passed to the `log_audit` RPC so every
 * client-initiated activity record carries device / session / source and (when
 * available) IP + coarse geolocation. Everything here is best-effort and never
 * throws — auditing must never break the action that triggered it.
 *
 * Privacy / honesty:
 *   • IP + geo come from the server (`/api/audit/context`, Vercel edge headers).
 *     When the platform doesn't provide them (e.g. local dev) we send nothing —
 *     we never fabricate a location.
 *   • No GPS permission is ever requested. (Priority-2 precise coordinates are
 *     intentionally not collected here; that would require explicit opt-in.)
 */

export interface AuditDevice {
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
}

export interface AuditGeo {
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface AuditContext {
  session_id: string;
  source: string;
  user_agent: string;
  device: AuditDevice;
  ip_address?: string;
  geo?: AuditGeo;
}

const SESSION_KEY = 'reyna_audit_session_id';

// ── Session id ────────────────────────────────────────────────────────────────
// A stable id for the current browser tab/session. Lets us correlate a burst of
// actions and detect "new session" security signals — without any PII.
function getSessionId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `s_${Date.now().toString(36)}`;
  }
}

// ── Device / browser / OS parsing ────────────────────────────────────────────
// Lightweight UA parser — intentionally dependency-free. Good enough to display
// "Chrome 124 · macOS · Desktop" and to compute new-device/new-browser signals.
function parseDevice(ua: string): AuditDevice {
  const u = ua || '';

  // OS
  let os = 'Unknown';
  let osVersion = '';
  if (/windows nt/i.test(u)) {
    os = 'Windows';
    const m = u.match(/windows nt ([\d.]+)/i);
    const map: Record<string, string> = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    osVersion = m ? (map[m[1]] ?? m[1]) : '';
  } else if (/mac os x/i.test(u)) {
    os = 'macOS';
    const m = u.match(/mac os x ([\d_]+)/i);
    osVersion = m ? m[1].replace(/_/g, '.') : '';
  } else if (/android/i.test(u)) {
    os = 'Android';
    const m = u.match(/android ([\d.]+)/i);
    osVersion = m ? m[1] : '';
  } else if (/(iphone|ipad|ipod)/i.test(u)) {
    os = 'iOS';
    const m = u.match(/os ([\d_]+)/i);
    osVersion = m ? m[1].replace(/_/g, '.') : '';
  } else if (/linux/i.test(u)) {
    os = 'Linux';
  }

  // Browser (order matters — Edge/Opera/Brave masquerade as Chrome)
  let browser = 'Unknown';
  let browserVersion = '';
  const pick = (re: RegExp): string => {
    const m = u.match(re);
    return m ? m[1] : '';
  };
  if (/edg(e|a|ios)?\//i.test(u)) {
    browser = 'Edge';
    browserVersion = pick(/edg(?:e|a|ios)?\/([\d.]+)/i);
  } else if (/opr\//i.test(u) || /opera/i.test(u)) {
    browser = 'Opera';
    browserVersion = pick(/(?:opr|opera)\/([\d.]+)/i);
  } else if (/firefox\//i.test(u) || /fxios\//i.test(u)) {
    browser = 'Firefox';
    browserVersion = pick(/(?:firefox|fxios)\/([\d.]+)/i);
  } else if (/chrome\//i.test(u) || /crios\//i.test(u)) {
    browser = 'Chrome';
    browserVersion = pick(/(?:chrome|crios)\/([\d.]+)/i);
  } else if (/safari\//i.test(u) && /version\//i.test(u)) {
    browser = 'Safari';
    browserVersion = pick(/version\/([\d.]+)/i);
  }

  // Device type
  let deviceType: AuditDevice['deviceType'] = 'unknown';
  if (/ipad|tablet/i.test(u) || (/android/i.test(u) && !/mobile/i.test(u))) {
    deviceType = 'tablet';
  } else if (/mobi|iphone|ipod|android.*mobile/i.test(u)) {
    deviceType = 'mobile';
  } else if (u) {
    deviceType = 'desktop';
  }

  return {
    browser,
    browserVersion: browserVersion.split('.').slice(0, 2).join('.'),
    os,
    osVersion,
    deviceType,
  };
}

// ── IP + geo (server-observed, fetched once and cached) ──────────────────────
let netPromise: Promise<{ ip?: string; geo?: AuditGeo }> | null = null;

async function getNetwork(): Promise<{ ip?: string; geo?: AuditGeo }> {
  if (typeof window === 'undefined') return {};
  if (netPromise) return netPromise;

  netPromise = (async () => {
    try {
      const res = await fetch('/api/audit/context', { cache: 'no-store' });
      if (!res.ok) return {};
      const data = (await res.json()) as { ip?: string | null; geo?: AuditGeo | null };
      return {
        ip: data.ip ?? undefined,
        geo: data.geo ?? undefined,
      };
    } catch {
      return {};
    }
  })();

  return netPromise;
}

// ── Public API ────────────────────────────────────────────────────────────────
let cachedDevice: AuditDevice | null = null;

/**
 * Build the audit context for the current client. Resolves quickly (the network
 * lookup is cached after the first call). Always returns a usable object.
 */
export async function getAuditContext(): Promise<AuditContext> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (!cachedDevice) cachedDevice = parseDevice(ua);

  const base: AuditContext = {
    session_id: getSessionId(),
    source: 'Dashboard',
    user_agent: ua,
    device: cachedDevice,
  };

  const net = await getNetwork();
  if (net.ip) base.ip_address = net.ip;
  if (net.geo) base.geo = net.geo;

  return base;
}

// Loose shapes accepted by the formatters — values may come from jsonb columns
// where the precise literal types aren't preserved.
type DeviceLike = {
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  deviceType?: string;
};
type GeoLike = {
  country?: string | null;
  region?: string | null;
  city?: string | null;
};

/**
 * Parse a raw user-agent string into a device object. Exposed so the UI can
 * derive browser/OS/device for activity rows that only have `user_agent`
 * (e.g. server-RPC-logged actions) and not the structured `device` jsonb.
 */
export function deviceFromUserAgent(ua: string | null | undefined): AuditDevice | null {
  if (!ua) return null;
  const d = parseDevice(ua);
  // Nothing useful detected → treat as absent rather than showing "Unknown".
  if (d.browser === 'Unknown' && d.os === 'Unknown' && d.deviceType === 'unknown') return null;
  return d;
}

/** Format a device object into a compact label, e.g. "Chrome 124 · macOS · Desktop". */
export function describeDevice(device: DeviceLike | null | undefined): string {

  if (!device) return '';
  const parts: string[] = [];
  if (device.browser && device.browser !== 'Unknown') {
    parts.push(device.browserVersion ? `${device.browser} ${device.browserVersion}` : device.browser);
  }
  if (device.os && device.os !== 'Unknown') {
    parts.push(device.osVersion ? `${device.os} ${device.osVersion}` : device.os);
  }
  if (device.deviceType && device.deviceType !== 'unknown') {
    parts.push(device.deviceType.charAt(0).toUpperCase() + device.deviceType.slice(1));
  }
  return parts.join(' · ');
}

/** Format a geo object into a human line, e.g. "Paris, Île-de-France, France". */
export function describeLocation(geo: GeoLike | null | undefined): string {
  if (!geo) return '';
  return [geo.city, geo.region, geo.country].filter(Boolean).join(', ');
}


