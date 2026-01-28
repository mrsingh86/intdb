import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Shipment Details | Intoglo Pulse';
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
          <svg width="60" height="69" viewBox="0 0 520 601" fill="none">
            <path d="M0 600.517L346.711 0L520.064 300.259L346.711 600.517H0Z" fill="#E72566"/>
            <path d="M0 0L346.711 600.518L520.064 300.258L346.711 0H0Z" fill="#E72566"/>
            <path d="M129.111 376.892L173.355 300.257L346.711 600.517L129.111 376.892Z" fill="#8B001D"/>
          </svg>
          <span style={{ fontSize: 56, fontWeight: 'bold', color: 'white', marginLeft: 20 }}>
            intoglo
          </span>
          <div style={{ width: 2, height: 40, backgroundColor: '#374151', marginLeft: 20, marginRight: 20 }} />
          <span style={{ fontSize: 40, fontWeight: 600, color: '#E72566' }}>PULSE</span>
        </div>

        {/* Shipment Card */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: 'rgba(231, 37, 102, 0.1)',
            border: '2px solid rgba(231, 37, 102, 0.3)',
            borderRadius: 20,
            padding: '32px 48px',
          }}
        >
          <span style={{ fontSize: 64 }}>📦</span>
          <span style={{ fontSize: 36, fontWeight: 'bold', color: 'white', marginTop: 16 }}>
            Shipment Details
          </span>
          <span style={{ fontSize: 24, color: '#9ca3af', marginTop: 8 }}>
            Shared via Intoglo Pulse
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
