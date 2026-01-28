import Link from 'next/link';

/**
 * Root page - Landing page for Intoglo Intelligence Platform
 */
export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        {/* Logo */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <svg className="w-10 h-10" viewBox="0 0 520 601" fill="none">
              <path d="M0 600.517L346.711 0L520.064 300.259L346.711 600.517H0Z" fill="#E72566"/>
              <path d="M0 0L346.711 600.518L520.064 300.258L346.711 0H0Z" fill="#E72566"/>
              <path d="M129.111 376.892L173.355 300.257L346.711 600.517L129.111 376.892Z" fill="#8B001D"/>
            </svg>
            <span className="text-3xl font-bold text-white">intoglo</span>
          </div>
          <p className="text-gray-400">Freight Intelligence Platform</p>
        </div>

        {/* App Cards */}
        <div className="space-y-4">
          {/* Pulse */}
          <Link href="/pulse" className="block">
            <div className="bg-gradient-to-r from-pink-900/30 to-gray-900 border border-pink-800/50 rounded-xl p-6 hover:border-pink-600 transition-all hover:scale-[1.02]">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-pink-600/20 flex items-center justify-center">
                  <span className="text-2xl">📦</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Pulse</h2>
                  <p className="text-gray-400 text-sm">Shipment Intelligence Bot</p>
                </div>
                <svg className="w-5 h-5 text-gray-500 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <p className="text-gray-500 text-sm mt-3">
                Search shipments, view dossiers, track containers, share updates
              </p>
            </div>
          </Link>

          {/* Chronicle */}
          <Link href="/chronicle/shipments" className="block">
            <div className="bg-gradient-to-r from-blue-900/30 to-gray-900 border border-blue-800/50 rounded-xl p-6 hover:border-blue-600 transition-all hover:scale-[1.02]">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-600/20 flex items-center justify-center">
                  <span className="text-2xl">📧</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Chronicle</h2>
                  <p className="text-gray-400 text-sm">Email Intelligence Dashboard</p>
                </div>
                <svg className="w-5 h-5 text-gray-500 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <p className="text-gray-500 text-sm mt-3">
                Process emails, extract documents, manage shipment data
              </p>
            </div>
          </Link>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-600 text-xs">
          Powered by AI • Built for Freight Forwarding
        </p>
      </div>
    </div>
  );
}
