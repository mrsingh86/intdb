'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Ship,
  Compass,
  Link2,
} from 'lucide-react'

// Flat navigation - no submenus
const navigation = [
  { name: 'Mission Control', href: '/mission-control', icon: Compass },
  { name: 'Shipments', href: '/shipments', icon: Ship },
  { name: 'Link Review', href: '/shipments/link-review', icon: Link2 },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-full w-64 flex-col bg-terminal-bg dark:bg-terminal-bg">
      {/* Logo */}
      <div className="flex h-16 items-center justify-between px-6 border-b border-terminal-border">
        <div className="flex items-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-terminal-green/20 border border-terminal-green/30">
            <span className="text-sm font-bold font-mono text-terminal-green">O</span>
          </div>
          <div className="ml-3">
            <h2 className="text-lg font-semibold text-terminal-text">Orion</h2>
            <p className="text-xs text-terminal-muted font-mono">v1.0</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href ||
                          (item.href !== '/' && item.href !== '/mission-control' && pathname.startsWith(item.href))

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`
                group flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors
                ${isActive
                  ? 'bg-terminal-elevated text-terminal-green border border-terminal-green/30'
                  : 'text-terminal-muted hover:bg-terminal-surface hover:text-terminal-text border border-transparent'
                }
              `}
            >
              <item.icon
                className={`
                  mr-3 h-5 w-5 flex-shrink-0 transition-colors
                  ${isActive ? 'text-terminal-green' : 'text-terminal-muted group-hover:text-terminal-text'}
                `}
              />
              {item.name}
              {isActive && (
                <span className="ml-auto text-terminal-green font-mono text-xs">{'>'}</span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Command hint */}
      <div className="px-6 py-3 border-t border-terminal-border">
        <div className="flex items-center justify-between text-xs text-terminal-muted font-mono">
          <span>Quick Search</span>
          <kbd className="px-1.5 py-0.5 rounded bg-terminal-surface border border-terminal-border text-terminal-text">
            Cmd+K
          </kbd>
        </div>
      </div>

      {/* User Section */}
      <div className="border-t border-terminal-border px-6 py-4">
        <div className="flex items-center">
          <div className="h-8 w-8 rounded-full bg-terminal-surface border border-terminal-border flex items-center justify-center">
            <span className="text-xs font-medium font-mono text-terminal-green">DT</span>
          </div>
          <div className="ml-3">
            <p className="text-sm font-medium text-terminal-text">Dinesh T</p>
            <p className="text-xs text-terminal-muted font-mono">admin</p>
          </div>
        </div>
      </div>
    </div>
  )
}
