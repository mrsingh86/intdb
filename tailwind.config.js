/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // Force generation of all terminal color classes
  safelist: [
    // Text colors
    'text-terminal-green',
    'text-terminal-amber',
    'text-terminal-red',
    'text-terminal-blue',
    'text-terminal-purple',
    'text-terminal-text',
    'text-terminal-muted',
    // Background colors
    'bg-terminal-bg',
    'bg-terminal-surface',
    'bg-terminal-elevated',
    'bg-terminal-green',
    'bg-terminal-amber',
    'bg-terminal-red',
    'bg-terminal-blue',
    'bg-terminal-purple',
    'bg-terminal-green/10',
    'bg-terminal-green/20',
    'bg-terminal-amber/10',
    'bg-terminal-amber/20',
    'bg-terminal-red/10',
    'bg-terminal-red/20',
    'bg-terminal-blue/10',
    'bg-terminal-blue/20',
    // Border colors
    'border-terminal-border',
    'border-terminal-green',
    'border-terminal-green/30',
    'border-terminal-amber',
    'border-terminal-amber/30',
    'border-terminal-red',
    'border-terminal-red/30',
    'border-terminal-red/50',
    'border-terminal-blue',
    'border-terminal-blue/30',
    // Hover states
    'hover:bg-terminal-elevated',
    'hover:bg-terminal-surface',
    'hover:text-terminal-text',
    'hover:border-terminal-border',
    'hover:border-terminal-muted',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6',
        secondary: '#8b5cf6',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        // Terminal-inspired colors (Homebrew style)
        terminal: {
          bg: '#0d1117',
          surface: '#161b22',
          elevated: '#21262d',
          border: '#30363d',
          green: '#3fb950',
          amber: '#d29922',
          red: '#f85149',
          blue: '#58a6ff',
          purple: '#a371f7',
          text: '#e6edf3',
          muted: '#8b949e',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
