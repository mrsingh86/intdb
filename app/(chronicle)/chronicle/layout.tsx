'use client';

import { Ship, Search, Bell, RefreshCw } from 'lucide-react';
import { useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Chronicle Layout - Clean & Minimal
 *
 * Simple header, maximum content space.
 * No sidebar, no panels - just shipments.
 */

interface LayoutProps {
  children: React.ReactNode;
}

export default function ChronicleLayout({ children }: LayoutProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pathname = usePathname();

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    window.location.reload();
  }, []);

  return (
    <div className="min-h-screen bg-terminal-bg">
      {/* Minimal Header */}
      <header className="sticky top-0 z-50 border-b border-terminal-border bg-terminal-surface">
        <div className="flex h-14 items-center justify-between px-6">
          {/* Left: Logo & Title */}
          <Link href="/chronicle/shipments" className="flex items-center gap-3 group">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-terminal-purple/20">
              <Ship className="h-4 w-4 text-terminal-purple" />
            </div>
            <span className="text-base font-semibold text-terminal-text">
              Chronicle
            </span>
          </Link>

          {/* Right: Actions */}
          <div className="flex items-center gap-3">
            {/* Search hint */}
            <div className="hidden sm:flex items-center gap-1.5 rounded-md border border-terminal-border px-2.5 py-1.5 text-sm text-terminal-muted">
              <Search className="h-3.5 w-3.5" />
              <span className="font-mono">Search</span>
              <kbd className="ml-1 rounded px-1.5 py-0.5 text-xs bg-terminal-elevated text-terminal-muted">
                /
              </kbd>
            </div>

            {/* Refresh */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex h-8 w-8 items-center justify-center rounded-md text-terminal-muted hover:text-terminal-text hover:bg-terminal-elevated transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            {/* Notifications */}
            <button
              className="relative flex h-8 w-8 items-center justify-center rounded-md text-terminal-muted hover:text-terminal-text hover:bg-terminal-elevated transition-colors"
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-terminal-red rounded-full" />
            </button>

            {/* Date */}
            <div className="hidden sm:flex items-center rounded-md px-2.5 py-1.5 text-sm font-mono text-terminal-muted">
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
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
