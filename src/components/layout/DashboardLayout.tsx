import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Navigation } from './Navigation';

export function DashboardLayout() {
  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-950 via-neutral-900 to-neutral-950 overflow-x-hidden">
      <Header />
      <div className="max-w-[1800px] mx-auto p-8">
        <Navigation />
        <Outlet />
      </div>
    </div>
  );
}