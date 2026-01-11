'use client';

import { Sidebar } from '../../components/layout/sidebar';
import { TopBar } from '../../components/layout/topbar';

export default function OrionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-terminal-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6 bg-terminal-bg">
          {children}
        </main>
      </div>
    </div>
  );
}
