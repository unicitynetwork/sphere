import { useEffect } from 'react';
import { useTheme } from '../../hooks/useTheme';

/**
 * Component that initializes theme on app load.
 * Place this at the root of your app to ensure theme is applied before render.
 */
export function ThemeInitializer({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();

  // This effect runs on mount to ensure theme class is applied
  useEffect(() => {
    // Theme is already applied by useTheme hook, but we ensure it here
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, [theme]);

  return <>{children}</>;
}
