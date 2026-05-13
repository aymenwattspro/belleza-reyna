'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home, LayoutDashboard, Users, ShoppingCart,
  History, LogOut, Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOrder } from '@/contexts/OrderContext';
import { useAuth } from '@/contexts/AuthContext';

interface NavItem {
  labelKey: 'nav_home' | 'nav_dashboard' | 'nav_suppliers' | 'nav_total_order' | 'nav_order_history';
  descKey: 'nav_description_home' | 'nav_description_dashboard' | 'nav_description_suppliers' | 'nav_description_order' | 'nav_description_history';
  href: string;
  icon: React.ElementType;
  badgeFn?: () => number | null;
}

const NAV_ITEMS: NavItem[] = [
  { labelKey: 'nav_home',          descKey: 'nav_description_home',      href: '/inventory-hub', icon: Home },
  { labelKey: 'nav_dashboard',     descKey: 'nav_description_dashboard',  href: '/dashboard',     icon: LayoutDashboard },
  { labelKey: 'nav_suppliers',     descKey: 'nav_description_suppliers',  href: '/suppliers',     icon: Users },
  { labelKey: 'nav_total_order',   descKey: 'nav_description_order',      href: '/orders',        icon: ShoppingCart },
  { labelKey: 'nav_order_history', descKey: 'nav_description_history',    href: '/history',       icon: History },
];

export function Sidebar() {
  const pathname = usePathname();
  const { t, lang, setLang } = useLanguage();
  const { orderLines } = useOrder();

  const { signOut } = useAuth();
  const pendingOrderCount = orderLines.filter(l => l.selected).length;

  // signOut() (from AuthContext) already clears state + redirects to /login.
  // We do NOT redirect here to avoid duplicate router calls.
  const handleLogout = () => signOut();

  return (
    <aside className="fixed top-0 left-0 h-screen w-64 flex flex-col bg-white border-r border-gray-100 z-40 shadow-sm">
      {/* ── Brand Header ── */}
      <div className="px-5 py-5 border-b border-gray-100">
        <Link href="/inventory-hub" className="flex items-center gap-3 group">
          <div className="relative w-10 h-10 rounded-xl overflow-hidden bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-500 flex items-center justify-center shadow-md shadow-pink-200/60 flex-shrink-0">
            <Image
              src="/logoreyna.png"
              alt="Belleza Reyna"
              width={40}
              height={40}
              className="object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900 leading-tight truncate group-hover:text-pink-600 transition-colors">
              {t('brand_name')}
            </p>
            <p className="text-[10px] text-gray-400 font-medium leading-tight">
              {t('brand_tagline')}
            </p>
          </div>
        </Link>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
        <div className="px-2 mb-3">
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
            {lang === 'es' ? 'Navegación' : 'Navigation'}
          </p>
        </div>

        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          const badge = item.href === '/orders' && pendingOrderCount > 0 ? pendingOrderCount : null;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 group relative',
                isActive
                  ? 'bg-gradient-to-r from-rose-50 to-pink-50 text-pink-700 shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-gradient-to-b from-rose-500 to-pink-500 rounded-full" />
              )}

              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all',
                isActive
                  ? 'bg-gradient-to-br from-rose-500 to-pink-500 text-white shadow-sm shadow-pink-300/50'
                  : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200'
              )}>
                <Icon size={15} />
              </div>

              <div className="flex-1 min-w-0">
                <p className={cn(
                  'text-sm font-semibold leading-tight truncate',
                  isActive ? 'text-pink-700' : 'text-gray-700 group-hover:text-gray-900'
                )}>
                  {t(item.labelKey)}
                </p>
                <p className="text-[10px] text-gray-400 leading-tight truncate mt-0.5">
                  {t(item.descKey)}
                </p>
              </div>

              {badge !== null && (
                <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Bottom: Language Toggle + Logout ── */}
      <div className="px-3 py-4 border-t border-gray-100 space-y-2">
        {/* Language Toggle */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border border-gray-100">
          <Globe size={14} className="text-gray-400 flex-shrink-0" />
          <span className="text-xs text-gray-500 flex-1">
            {lang === 'en' ? 'Language' : 'Idioma'}
          </span>
          <button
            onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all',
              lang === 'es'
                ? 'bg-pink-500 text-white border-pink-500 shadow-sm'
                : 'bg-white text-gray-700 border-gray-200 hover:border-pink-300 hover:text-pink-600'
            )}
          >
            {lang === 'en' ? '🇲🇽 ES' : '🇺🇸 EN'}
          </button>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-500 hover:bg-red-50 hover:text-red-600 transition-all group"
        >
          <div className="w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-red-100 flex items-center justify-center flex-shrink-0 transition-colors">
            <LogOut size={14} />
          </div>
          <span className="text-sm font-medium">{t('logout')}</span>
        </button>
      </div>
    </aside>
  );
}
