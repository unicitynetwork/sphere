interface QuickAction {
  label: string;
  message: string;
}

interface QuickActionsProps {
  actions: QuickAction[];
  onAction: (message: string) => void;
  disabled?: boolean;
}

export function QuickActions({ actions, onAction, disabled = false }: QuickActionsProps) {
  if (!actions.length) return null;

  return (
    <div className="px-4 py-2 border-t border-neutral-800/30 relative z-10">
      <div className="flex gap-2 overflow-x-auto">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={() => onAction(action.message)}
            disabled={disabled}
            className="px-3 py-1.5 rounded-lg bg-neutral-800/50 text-neutral-400 text-sm hover:bg-neutral-700/50 hover:text-white transition-colors whitespace-nowrap disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
