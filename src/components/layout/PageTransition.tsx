'use client';

/**
 * PageTransition — context-aware route transitions for the App Router.
 *
 * Rather than a single global animation, the transition adapts to *where* the
 * user is going (inferred from the URL depth + top-level section):
 *
 *   • Drill-in   (list → record, e.g. /activity → /activity/123)
 *                 → content rises with a subtle zoom-in ("entering" feel).
 *   • Back       (record → list)
 *                 → content settles in from above ("stepping back" feel).
 *   • Section    (switching top-level area via the sidebar)
 *                 → a clean fade-up.
 *   • Default    (same view / first paint)
 *                 → a minimal fade.
 *
 * All movement is small (≤12px), quick (180–300ms) and uses soft easing so it
 * reads as premium and understated (Linear / Stripe), never playful. Transforms
 * only scale ≤1 / translate, so no horizontal scrollbars appear. Users who
 * prefer reduced motion get an instant, animation-free render.
 */

import React, { useRef } from 'react';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion, type Variants } from 'framer-motion';

// Soft "expo-out" easing — fast start, gentle settle.
const EASE_EXPO = [0.16, 1, 0.3, 1] as const;
const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

type Kind = 'drill' | 'back' | 'section' | 'fade';

const VARIANTS: Record<Kind, Variants> = {
  drill: {
    initial: { opacity: 0, y: 12, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.3, ease: EASE_EXPO } },
  },
  back: {
    initial: { opacity: 0, y: -10 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_EXPO } },
  },
  section: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_SMOOTH } },
  },
  fade: {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: EASE_SMOOTH } },
  },
};

const segments = (p: string) => p.split('/').filter(Boolean);

function pickKind(prev: string | null, next: string): Kind {
  if (!prev || prev === next) return 'fade';
  const a = segments(prev);
  const b = segments(next);
  if (b.length > a.length) return 'drill';
  if (b.length < a.length) return 'back';
  if (a[0] !== b[0]) return 'section';
  return 'fade';
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  // Holds the pathname from the *previous* navigation so we can infer direction.
  const prevRef = useRef<string | null>(null);
  const kind = pickKind(prevRef.current, pathname);

  // Record the current path for the next navigation (after render commits).
  React.useEffect(() => {
    prevRef.current = pathname;
  }, [pathname]);

  // Respect the user's reduced-motion preference — render with no animation.
  if (reduceMotion) return <>{children}</>;

  return (
    <motion.div
      key={pathname}
      variants={VARIANTS[kind]}
      initial="initial"
      animate="animate"
      // ⚠️ Do NOT set a persistent `will-change: transform` here.
      //   1. `will-change: transform` keeps this element permanently promoted to
      //      its own GPU layer, which re-rasterizes text and makes the whole page
      //      look slightly blurry / "lower resolution" than the sidebar.
      //   2. Per the CSS spec, `will-change: transform` makes this element a
      //      *containing block* for `position: fixed` descendants. Because this
      //      wrapper is `min-h-screen` (often taller than the viewport), any
      //      `fixed inset-0` modal inside a page would stretch across the full
      //      document and center its dialog far down the page — appearing
      //      "hidden". Letting Framer Motion manage will-change only *during* the
      //      transition (and reset transform to `none` once settled) keeps modals
      //      anchored to the viewport and text crisp.
      className="min-h-screen"
    >
      {children}
    </motion.div>
  );
}


