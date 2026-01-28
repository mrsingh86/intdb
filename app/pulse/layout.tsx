import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pulse | Intoglo',
  description: 'Shipment Intelligence Bot - Search shipments, track containers, share updates instantly',
  openGraph: {
    title: 'Pulse | Intoglo',
    description: 'Shipment Intelligence Bot - Search shipments, track containers, share updates instantly',
    siteName: 'Intoglo',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pulse | Intoglo',
    description: 'Shipment Intelligence Bot - Search shipments, track containers, share updates instantly',
  },
};

export default function PulseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
