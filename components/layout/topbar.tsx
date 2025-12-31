'use client'

import { useState } from 'react'
import { Search, Bell, RefreshCw, Command } from 'lucide-react'

export function TopBar() {
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await new Promise(resolve => setTimeout(resolve, 1000))
    setIsRefreshing(false)
    window.location.reload()
  }

  return (
    <div className="flex h-14 items-center justify-between border-b border-terminal-border bg-terminal-surface px-6">
      {/* Search Hint */}
      <div className="flex items-center">
        <button
          onClick={() => {
            // Trigger Cmd+K
            const event = new KeyboardEvent('keydown', {
              key: 'k',
              metaKey: true,
              bubbles: true
            })
            document.dispatchEvent(event)
          }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-terminal-border bg-terminal-elevated text-terminal-muted hover:bg-terminal-border transition-colors"
        >
          <Search className="h-4 w-4" />
          <span className="text-sm">Search...</span>
          <kbd className="ml-8 px-1.5 py-0.5 text-xs rounded bg-terminal-surface border border-terminal-border font-mono text-terminal-green">
            <Command className="h-3 w-3 inline" />K
          </kbd>
        </button>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleRefresh}
          className={`rounded-lg p-2 text-terminal-muted hover:bg-terminal-elevated transition-colors ${
            isRefreshing ? 'animate-spin' : ''
          }`}
          disabled={isRefreshing}
          title="Refresh data"
        >
          <RefreshCw className="h-4 w-4" />
        </button>

        <button
          className="relative rounded-lg p-2 text-terminal-muted hover:bg-terminal-elevated transition-colors"
          title="Notifications"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-terminal-red"></span>
        </button>

        <div className="ml-2 h-6 w-px bg-terminal-border"></div>

        <div className="ml-2 flex items-center gap-2">
          <span className="text-xs text-terminal-muted">Status:</span>
          <span className="flex items-center gap-1 text-xs font-mono text-terminal-green">
            <span className="h-1.5 w-1.5 rounded-full bg-terminal-green animate-pulse"></span>
            ONLINE
          </span>
        </div>
      </div>
    </div>
  )
}
