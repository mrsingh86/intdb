import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Pulse | Intoglo - Shipment Intelligence';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0f',
          backgroundImage: 'linear-gradient(135deg, #1a0a1a 0%, #0a0a0f 50%, #0a1a1a 100%)',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 40 }}>
          <svg width="80" height="92" viewBox="0 0 520 601" fill="none">
            <path d="M0 600.517L346.711 0L520.064 300.259L346.711 600.517H0Z" fill="#E72566"/>
            <path d="M0 0L346.711 600.518L520.064 300.258L346.711 0H0Z" fill="#E72566"/>
            <path d="M129.111 376.892L173.355 300.257L346.711 600.517L129.111 376.892Z" fill="#8B001D"/>
          </svg>
          <span style={{ fontSize: 72, fontWeight: 'bold', color: 'white', marginLeft: 24 }}>
            intoglo
          </span>
        </div>

        {/* Pulse Badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            backgroundColor: 'rgba(231, 37, 102, 0.15)',
            border: '2px solid rgba(231, 37, 102, 0.4)',
            borderRadius: 16,
            padding: '16px 32px',
            marginBottom: 24,
          }}
        >
          <span style={{ fontSize: 48 }}>📦</span>
          <span style={{ fontSize: 48, fontWeight: 'bold', color: '#E72566' }}>PULSE</span>
        </div>

        {/* Tagline */}
        <p style={{ fontSize: 32, color: '#9ca3af', margin: 0 }}>
          Shipment Intelligence Bot
        </p>
      </div>
    ),
    { ...size }
  );
}
