import { redirect } from 'next/navigation';

/**
 * Root page - Redirects to Chronicle V2 Dashboard
 */
export default function HomePage() {
  redirect('/v2');
}
