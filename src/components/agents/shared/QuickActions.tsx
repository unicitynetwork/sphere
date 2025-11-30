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

  // Check if label is a single character (like A, B, C, D)
  const isCompact = (label: string) => label.length === 1;

  // Separate regular actions from compact (single-char) actions
  const regularActions = actions.filter(a => !isCompact(a.label));
  const compactActions = actions.filter(a => isCompact(a.label));

  return (
    <div className="px-4 py-2 border-t border-neutral-800/30 relative z-10 space-y-2">
      {/* Regular actions */}
      {regularActions.length > 0 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {regularActions.map((action) => (
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
      )}
      {/* Compact actions (A, B, C, D) on second row */}
      {compactActions.length > 0 && (
        <div className="flex gap-2">
          {compactActions.map((action) => (
            <button
              key={action.label}
              onClick={() => onAction(action.message)}
              disabled={disabled}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-neutral-800/50 text-neutral-400 text-sm hover:bg-neutral-700/50 hover:text-white transition-colors disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
