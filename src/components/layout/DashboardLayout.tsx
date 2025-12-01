import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { useIncomingTransfers } from '../wallet/L3/hooks/useIncomingTransfers';

export function DashboardLayout() {

  useIncomingTransfers();

  return (
    <div className="min-h-screen lg:min-h-screen h-dvh lg:h-auto bg-neutral-100 dark:bg-linear-to-br dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950 overflow-x-hidden overflow-y-auto lg:overflow-y-visible overscroll-none theme-transition">
      <Header />
      <div className="max-w-[1800px] mx-auto p-4 md:p-8">
        <Outlet />
      </div>
    </div>
  );
}
