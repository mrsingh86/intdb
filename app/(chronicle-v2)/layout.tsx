'use client';

import { Ship, Search, Bell, RefreshCw, Package } from 'lucide-react';
import { useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Chronicle V2 Layout
 *
 * Uses the Chronicle Ink theme - calm by default, clear when needed.
 * Minimal header, maximum content space.
 */

interface LayoutProps {
  children: React.ReactNode;
}

export default function ChronicleV2Layout({ children }: LayoutProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pathname = usePathname();

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    // Trigger page refresh
    window.location.reload();
  }, []);

  const isShipments = pathname?.startsWith('/v2');

  return (
    <div className="chronicle-ink min-h-screen" style={{ backgroundColor: 'var(--ink-bg)' }}>
      {/* Minimal Header */}
      <header
        className="sticky top-0 z-50 border-b"
        style={{
          backgroundColor: 'var(--ink-surface)',
          borderColor: 'var(--ink-border-subtle)',
        }}
      >
        <div className="flex h-14 items-center justify-between px-6">
          {/* Left: Logo & Title */}
          <div className="flex items-center gap-6">
            {/* Logo */}
            <Link href="/v2" className="flex items-center gap-3 group">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ backgroundColor: 'var(--ink-info-bg)' }}
              >
                <Ship className="h-4 w-4" style={{ color: 'var(--ink-accent)' }} />
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="text-base font-semibold tracking-tight"
                  style={{ color: 'var(--ink-text)', fontFamily: 'var(--ink-font-sans)' }}
                >
                  Chronicle
                </span>
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: 'var(--ink-elevated)',
                    color: 'var(--ink-text-muted)',
                  }}
                >
                  v2
                </span>
              </div>
            </Link>

            {/* Navigation */}
            <nav className="flex items-center gap-1">
              <Link
                href="/v2"
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                style={{
                  backgroundColor: isShipments ? 'var(--ink-elevated)' : 'transparent',
                  color: isShipments ? 'var(--ink-text)' : 'var(--ink-text-muted)',
                }}
              >
                <Package className="h-4 w-4" />
                Shipments
              </Link>
            </nav>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {/* Search shortcut hint */}
            <div
              className="hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm sm:flex"
              style={{
                borderColor: 'var(--ink-border-subtle)',
                color: 'var(--ink-text-muted)',
              }}
            >
              <Search className="h-3.5 w-3.5" />
              <span style={{ fontFamily: 'var(--ink-font-sans)' }}>Search</span>
              <kbd
                className="ml-1 rounded px-1.5 py-0.5 text-xs"
                style={{
                  backgroundColor: 'var(--ink-elevated)',
                  color: 'var(--ink-text-muted)',
                }}
              >
                /
              </kbd>
            </div>

            {/* Refresh */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex h-8 w-8 items-center justify-center rounded-md transition-colors"
              style={{
                color: 'var(--ink-text-muted)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--ink-elevated)';
                e.currentTarget.style.color = 'var(--ink-text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--ink-text-muted)';
              }}
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            {/* Notifications placeholder */}
            <button
              className="relative flex h-8 w-8 items-center justify-center rounded-md transition-colors"
              style={{
                color: 'var(--ink-text-muted)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--ink-elevated)';
                e.currentTarget.style.color = 'var(--ink-text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--ink-text-muted)';
              }}
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
            </button>

            {/* Current date */}
            <div
              className="hidden items-center rounded-md px-2.5 py-1.5 text-sm sm:flex"
              style={{
                color: 'var(--ink-text-muted)',
                fontFamily: 'var(--ink-font-sans)',
              }}
            >
              {new Date().toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
