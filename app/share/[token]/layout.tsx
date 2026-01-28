import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shipment Details | Intoglo Pulse',
  description: 'View shared shipment tracking information',
  openGraph: {
    title: 'Shipment Details | Intoglo Pulse',
    description: 'View shared shipment tracking information',
    siteName: 'Intoglo',
    type: 'website',
  },
};

export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
