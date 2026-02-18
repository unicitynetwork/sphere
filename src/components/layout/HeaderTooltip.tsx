import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface HeaderTooltipProps {
  label: string;
  children: React.ReactNode;
}

export function HeaderTooltip({ label, children }: HeaderTooltipProps) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLSpanElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleEnter = useCallback(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ x: rect.left + rect.width / 2, y: rect.bottom + 8 });
    }
    setShow(true);
  }, []);

  return (
    <span
      ref={ref}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setShow(false)}
      style={{ display: 'inline-flex' }}
    >
      {children}
      {mounted && show && createPortal(
        <div
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            transform: 'translateX(-50%)',
            zIndex: 99999,
            pointerEvents: 'none',
          }}
          className="px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap bg-neutral-900 dark:bg-neutral-800 text-neutral-100 border border-neutral-700 shadow-lg"
        >
          {label}
        </div>,
        document.body,
      )}
    </span>
  );
}
