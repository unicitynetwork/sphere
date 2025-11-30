import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Navigation } from './Navigation';
import { useIncomingTransfers } from '../wallet/L3/hooks/useIncomingTransfers';

export function DashboardLayout() {

  useIncomingTransfers();
  
  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-950 via-neutral-900 to-neutral-950 overflow-x-hidden">
      <Header />
      <div className="max-w-[1800px] mx-auto p-4 md:p-8">
        <Navigation />
        <Outlet />
      </div>
    </div>
  );
}