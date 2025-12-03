import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { useIncomingTransfers } from '../wallet/L3/hooks/useIncomingTransfers';

export function DashboardLayout() {

  useIncomingTransfers();

  return (
    <div className="h-full flex flex-col bg-neutral-100 dark:bg-linear-to-br dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950 theme-transition lg:overflow-auto">
      <Header />
      <div className="flex-1 min-h-0 max-w-[1800px] 2xl:max-w-[2200px] 3xl:max-w-[2800px] w-full mx-auto px-4 pt-4 pb-0 md:p-8 lg:pb-8 2xl:px-12 3xl:px-16">
        <Outlet />
      </div>
    </div>
  );
}
