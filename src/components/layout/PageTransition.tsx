'use client';

/**
 * PageTransition — subtle, fast route transitions for the App Router.
 *
 * On every pathname change the content gently fades + slides in (≈220ms). This
 * is intentionally understated (Linear / Stripe-style), not flashy. Users who
 * prefer reduced motion get an instant, animation-free render.
 */

import React from 'react';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  // Respect the user's reduced-motion preference — render with no animation.
  if (reduceMotion) return <>{children}</>;

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="min-h-screen"
    >
      {children}
    </motion.div>
  );
}
