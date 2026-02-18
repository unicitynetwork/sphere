import type { ReactNode } from 'react';

interface ChatContainerProps {
  children: ReactNode;
  bgGradient?: { from: string; to: string };
}

export function ChatContainer({
  children,
  bgGradient = { from: 'bg-indigo-500/5', to: 'bg-cyan-500/5' },
}: ChatContainerProps) {
  return (
    <div className="bg-white/60 dark:bg-neutral-900/70 backdrop-blur-xl rounded-none md:rounded-3xl lg:rounded-none border-0 md:border md:border-neutral-200 dark:md:border-neutral-800/50 lg:border-0 overflow-hidden grid grid-rows-1 relative lg:shadow-none h-full min-h-0 theme-transition">
      <div className={`absolute -top-20 -right-20 w-96 h-96 ${bgGradient.from} rounded-full blur-3xl`} />
      <div className={`absolute -bottom-20 -left-20 w-96 h-96 ${bgGradient.to} rounded-full blur-3xl`} />
      {children}
    </div>
  );
}
