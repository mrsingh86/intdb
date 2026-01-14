import { redirect } from 'next/navigation';

/**
 * Root page - Redirects to Chronicle Shipments Dashboard
 */
export default function HomePage() {
  redirect('/chronicle/shipments');
}
