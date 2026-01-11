'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Zap,
  Ship,
  FileText,
  LayoutDashboard,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertTriangle,
  Search,
  Bell,
  User,
  Settings,
} from 'lucide-react';

interface ChronicleLayoutProps {
  children: React.ReactNode;
}

export default function ChronicleLayout({ children }: ChronicleLayoutProps) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const navItems = [
    {
      href: '/chronicle',
      label: 'Command Center',
      icon: LayoutDashboard,
      exact: true,
    },
    {
      href: '/chronicle/shipments',
      label: 'Fleet View',
      icon: Ship,
      exact: false,
    },
  ];

  const isActive = (href: string, exact: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-terminal-bg flex">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-16' : 'w-64'
        } bg-terminal-surface border-r border-terminal-border flex flex-col transition-all duration-200`}
      >
        {/* Logo */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-terminal-border">
          {!sidebarCollapsed && (
            <Link href="/chronicle" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-terminal-purple/20 border border-terminal-purple/30 flex items-center justify-center">
                <Zap className="h-4 w-4 text-terminal-purple" />
              </div>
              <div>
                <span className="font-semibold text-terminal-text text-sm">Chronicle</span>
                <span className="text-[10px] font-mono text-terminal-muted block">Intelligence</span>
              </div>
            </Link>
          )}
          {sidebarCollapsed && (
            <div className="w-8 h-8 rounded-lg bg-terminal-purple/20 border border-terminal-purple/30 flex items-center justify-center mx-auto">
              <Zap className="h-4 w-4 text-terminal-purple" />
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-2 space-y-1">
          {navItems.map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  active
                    ? 'bg-terminal-purple/10 text-terminal-purple border border-terminal-purple/30'
                    : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-elevated'
                } ${sidebarCollapsed ? 'justify-center' : ''}`}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <item.icon className={`h-5 w-5 flex-shrink-0 ${active ? 'text-terminal-purple' : ''}`} />
                {!sidebarCollapsed && (
                  <span className="text-sm font-medium">{item.label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Collapse Toggle */}
        <div className="p-2 border-t border-terminal-border">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-terminal-muted hover:text-terminal-text hover:bg-terminal-elevated rounded-lg transition-colors"
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span className="text-xs font-mono">Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 bg-terminal-surface border-b border-terminal-border flex items-center justify-between px-6">
          {/* Breadcrumb */}
          <Breadcrumb pathname={pathname} />

          {/* Actions */}
          <div className="flex items-center gap-3">
            {/* Search */}
            <button className="flex items-center gap-2 px-3 py-1.5 bg-terminal-bg border border-terminal-border rounded-lg text-terminal-muted hover:text-terminal-text transition-colors">
              <Search className="h-4 w-4" />
              <span className="text-xs font-mono">Search...</span>
              <kbd className="text-[10px] bg-terminal-elevated px-1.5 py-0.5 rounded border border-terminal-border">⌘K</kbd>
            </button>

            {/* Time */}
            <ClientTime />

            {/* Notifications */}
            <button className="relative p-2 text-terminal-muted hover:text-terminal-text hover:bg-terminal-elevated rounded-lg transition-colors">
              <Bell className="h-4 w-4" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-terminal-red rounded-full" />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function Breadcrumb({ pathname }: { pathname: string }) {
  const segments = pathname.split('/').filter(Boolean);

  const breadcrumbItems = segments.map((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/');
    const isLast = index === segments.length - 1;

    // Format segment name
    let label = segment.charAt(0).toUpperCase() + segment.slice(1);
    if (segment === 'chronicle') label = 'Chronicle';
    if (segment === 'shipments') label = 'Fleet';

    // Check if it's a dynamic segment (ID)
    const isId = segment.match(/^[a-f0-9-]{20,}$/i);
    if (isId) label = `#${segment.slice(0, 8)}...`;

    return { href, label, isLast };
  });

  return (
    <div className="flex items-center gap-2 text-sm">
      {breadcrumbItems.map((item, index) => (
        <div key={item.href} className="flex items-center gap-2">
          {index > 0 && <span className="text-terminal-muted">/</span>}
          {item.isLast ? (
            <span className="font-medium text-terminal-text">{item.label}</span>
          ) : (
            <Link
              href={item.href}
              className="text-terminal-muted hover:text-terminal-blue transition-colors font-mono"
            >
              {item.label}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

function ClientTime() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    setTime(new Date().toLocaleTimeString());
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!time) return null;

  return (
    <span className="text-xs font-mono text-terminal-green flex items-center gap-1.5 bg-terminal-bg px-2 py-1 rounded border border-terminal-border">
      <Clock className="h-3 w-3" />
      {time}
    </span>
  );
}
