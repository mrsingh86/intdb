'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import {
  Search,
  Ship,
  FileText,
  Clock,
  AlertTriangle,
  Calendar,
  RefreshCw,
  ArrowRight,
  Loader2,
  Link2,
  Compass,
} from 'lucide-react'

interface SearchResult {
  id: string
  type: 'shipment' | 'document'
  title: string
  subtitle: string
  url: string
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])

  // Search API call with debounce
  useEffect(() => {
    if (!search || search.length < 2) {
      setResults([])
      return
    }

    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(search)}`)
        const data = await response.json()
        setResults(data.results || [])
      } catch (error) {
        console.error('Search failed:', error)
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [search])

  const runCommand = useCallback((command: () => void) => {
    onOpenChange(false)
    command()
  }, [onOpenChange])

  const navigateTo = useCallback((url: string) => {
    runCommand(() => router.push(url))
  }, [router, runCommand])

  // Navigation items
  const navigationItems = [
    { name: 'Mission Control', icon: Compass, url: '/mission-control' },
    { name: 'Shipments', icon: Ship, url: '/shipments' },
    { name: 'Link Review', icon: Link2, url: '/shipments/link-review' },
  ]

  // Quick filters
  const quickFilters = [
    { name: 'Critical Shipments', icon: AlertTriangle, url: '/shipments?priority=critical', color: 'text-terminal-red' },
    { name: 'Today\'s Arrivals', icon: Calendar, url: '/shipments?filter=arriving_today', color: 'text-terminal-blue' },
    { name: 'Today\'s Departures', icon: Calendar, url: '/shipments?filter=departing_today', color: 'text-terminal-green' },
    { name: 'Pre-Departure Shipments', icon: Clock, url: '/shipments?phase=pre_departure', color: 'text-terminal-amber' },
  ]

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'shipment': return Ship
      case 'document': return FileText
      default: return FileText
    }
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Global Command Menu"
      className="fixed inset-0 z-50"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div className="fixed left-1/2 top-1/4 -translate-x-1/2 w-full max-w-2xl">
        <div className="bg-terminal-surface rounded-xl shadow-2xl border border-terminal-border overflow-hidden">
          {/* Search Input */}
          <div className="flex items-center border-b border-terminal-border px-4">
            <Search className="h-5 w-5 text-terminal-muted mr-3" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search shipments, booking numbers..."
              className="flex-1 h-14 text-lg bg-transparent outline-none placeholder:text-terminal-muted text-terminal-text font-mono"
            />
            {loading && <Loader2 className="h-5 w-5 text-terminal-blue animate-spin" />}
            <kbd className="hidden sm:inline-flex h-6 items-center gap-1 rounded border border-terminal-border bg-terminal-elevated px-2 font-mono text-xs text-terminal-muted ml-3">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <Command.List className="max-h-[400px] overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-terminal-muted font-mono">
              {search.length >= 2 ? '> No results found' : '> Start typing to search...'}
            </Command.Empty>

            {/* Search Results */}
            {results.length > 0 && (
              <Command.Group heading="Search Results" className="mb-2">
                <div className="px-2 py-1.5 text-xs font-medium text-terminal-muted font-mono"># Search Results</div>
                {results.map((result) => {
                  const Icon = getTypeIcon(result.type)
                  return (
                    <Command.Item
                      key={result.id}
                      value={result.title}
                      onSelect={() => navigateTo(result.url)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-terminal-elevated aria-selected:bg-terminal-blue/20 aria-selected:border-terminal-blue/30"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-terminal-bg border border-terminal-border">
                        <Icon className="h-4 w-4 text-terminal-green" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-terminal-text truncate font-mono">{result.title}</div>
                        <div className="text-sm text-terminal-muted truncate">{result.subtitle}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-terminal-muted" />
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}

            {/* Quick Filters - show when no search or short search */}
            {search.length < 2 && (
              <>
                <Command.Group heading="Quick Filters">
                  <div className="px-2 py-1.5 text-xs font-medium text-terminal-muted font-mono"># Quick Filters</div>
                  {quickFilters.map((filter) => (
                    <Command.Item
                      key={filter.name}
                      value={filter.name}
                      onSelect={() => navigateTo(filter.url)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-terminal-elevated aria-selected:bg-terminal-blue/20"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-terminal-bg border border-terminal-border">
                        <filter.icon className={`h-4 w-4 ${filter.color}`} />
                      </div>
                      <span className="font-medium text-terminal-text font-mono">{filter.name}</span>
                      <ArrowRight className="h-4 w-4 text-terminal-muted ml-auto" />
                    </Command.Item>
                  ))}
                </Command.Group>

                <Command.Group heading="Navigation">
                  <div className="px-2 py-1.5 text-xs font-medium text-terminal-muted font-mono"># Navigation</div>
                  {navigationItems.map((item) => (
                    <Command.Item
                      key={item.name}
                      value={item.name}
                      onSelect={() => navigateTo(item.url)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-terminal-elevated aria-selected:bg-terminal-blue/20"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-terminal-bg border border-terminal-border">
                        <item.icon className="h-4 w-4 text-terminal-green" />
                      </div>
                      <span className="font-medium text-terminal-text font-mono">{item.name}</span>
                      <ArrowRight className="h-4 w-4 text-terminal-muted ml-auto" />
                    </Command.Item>
                  ))}
                </Command.Group>

                <Command.Group heading="Actions">
                  <div className="px-2 py-1.5 text-xs font-medium text-terminal-muted font-mono"># Actions</div>
                  <Command.Item
                    value="Refresh Data"
                    onSelect={() => runCommand(() => window.location.reload())}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-terminal-elevated aria-selected:bg-terminal-blue/20"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-terminal-bg border border-terminal-border">
                      <RefreshCw className="h-4 w-4 text-terminal-blue" />
                    </div>
                    <span className="font-medium text-terminal-text font-mono">Refresh Data</span>
                    <kbd className="ml-auto hidden sm:inline-flex h-5 items-center gap-1 rounded border border-terminal-border bg-terminal-elevated px-1.5 font-mono text-[10px] text-terminal-muted">
                      R
                    </kbd>
                  </Command.Item>
                </Command.Group>
              </>
            )}
          </Command.List>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-terminal-border bg-terminal-bg px-4 py-2">
            <div className="flex items-center gap-4 text-xs text-terminal-muted font-mono">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-terminal-border bg-terminal-surface px-1.5 py-0.5">↑↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-terminal-border bg-terminal-surface px-1.5 py-0.5">↵</kbd>
                select
              </span>
            </div>
            <div className="text-xs text-terminal-green font-mono">
              Orion v1.0
            </div>
          </div>
        </div>
      </div>
    </Command.Dialog>
  )
}
