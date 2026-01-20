import { Outlet } from 'react-router-dom';
import { Header } from './Header';

export function DashboardLayout() {
  return (
    <div className="h-full flex flex-col bg-neutral-100 dark:bg-linear-to-br dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950 theme-transition overflow-y-auto overflow-x-hidden">
      <Header />
      <div className="flex-1 min-h-0 max-w-[1800px] w-full mx-auto px-4 pt-4 pb-0 md:p-8 lg:pb-8">
        <Outlet />
      </div>
    </div>
  );
}
