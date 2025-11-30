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
    <div className="bg-linear-to-br from-neutral-900/60 to-neutral-800/40 backdrop-blur-xl rounded-3xl border border-neutral-800/50 overflow-hidden flex flex-col relative shadow-2xl h-full min-h-0">
      <div className={`absolute -top-20 -right-20 w-96 h-96 ${bgGradient.from} rounded-full blur-3xl`} />
      <div className={`absolute -bottom-20 -left-20 w-96 h-96 ${bgGradient.to} rounded-full blur-3xl`} />
      {children}
    </div>
  );
}
