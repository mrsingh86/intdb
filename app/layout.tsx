import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Sidebar } from '../components/layout/sidebar'
import { TopBar } from '../components/layout/topbar'
import { Providers } from '../components/providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Orion Intelligence Platform',
  description: 'AI-powered freight forwarding intelligence platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <div className="flex h-screen bg-terminal-bg">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
              <TopBar />
              <main className="flex-1 overflow-y-auto p-6 bg-terminal-bg">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  )
}
