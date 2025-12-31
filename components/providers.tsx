'use client'

import { useState, useEffect } from 'react'
import { ThemeProvider } from 'next-themes'
import { CommandPalette } from './ui/command-palette'

export function Providers({ children }: { children: React.ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Cmd+K (Mac) or Ctrl+K (Windows)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCommandOpen((open) => !open)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
      {children}
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </ThemeProvider>
  )
}
