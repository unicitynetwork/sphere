import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { useIncomingTransfers } from '../wallet/L3/hooks/useIncomingTransfers';

export function DashboardLayout() {

  useIncomingTransfers();

  return (
    <div className="min-h-screen lg:min-h-screen h-dvh lg:h-auto bg-linear-to-br from-neutral-950 via-neutral-900 to-neutral-950 overflow-x-hidden overflow-y-auto lg:overflow-y-visible overscroll-none">
      <Header />
      <div className="max-w-[1800px] mx-auto p-4 md:p-8">
        <Outlet />
      </div>
    </div>
  );
}