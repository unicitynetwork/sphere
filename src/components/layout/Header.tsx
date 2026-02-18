import { useState, useEffect } from 'react';
import { Github, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { isMock } from '../../hooks/useAgentChat';
import { ThemeToggle } from '../theme';
import { STORAGE_KEYS } from '../../config/storageKeys';
import { IpfsSyncIndicator } from './IpfsSyncIndicator';
import { useDesktopState } from '../../hooks/useDesktopState';

function devReset(): void {
  localStorage.removeItem(STORAGE_KEYS.DEV_AGGREGATOR_URL);
  localStorage.removeItem(STORAGE_KEYS.DEV_SKIP_TRUST_BASE);
  window.dispatchEvent(new Event("dev-config-changed"));
}
import logoUrl from '/Union.svg';

const DiscordIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

const navItems: { label: string; path: string; external?: boolean }[] = [
  { label: 'Home', path: '/agents/dm' },
  { label: 'Markets', path: '/markets' },
  { label: 'Agents', path: '/explore-agents' },
  { label: 'Devs', path: '/developers' },
  { label: 'About', path: '/about' },
];

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showDesktop } = useDesktopState();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMinePage = location.pathname === '/mine';

  // Dev config state for showing banner when non-default settings are active
  const getDevConfig = () => ({
    aggregatorUrl: localStorage.getItem(STORAGE_KEYS.DEV_AGGREGATOR_URL),
    skipTrustBase: localStorage.getItem(STORAGE_KEYS.DEV_SKIP_TRUST_BASE) === 'true',
  });
  const [devConfig, setDevConfig] = useState(getDevConfig);

  // Listen for dev config changes via custom event
  useEffect(() => {
    const handler = () => setDevConfig(getDevConfig());
    window.addEventListener('dev-config-changed', handler);
    return () => window.removeEventListener('dev-config-changed', handler);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Helper to get truncated hostname from URL
  const getHostname = (url: string): string => {
    try {
      const hostname = new URL(url).hostname;
      return hostname.length > 20 ? hostname.slice(0, 20) + '...' : hostname;
    } catch {
      return url.slice(0, 20);
    }
  };

  const handleMobileNavigation = (path: string) => {
    // Navigate first, menu will close via useEffect when location changes
    navigate(path);
  };

  const isActive = (path: string) => {
    if (!path) return false;
    if (path === '/agents/dm') {
      return location.pathname.startsWith('/agents/');
    }
    if (path === '/developers') {
      return location.pathname.startsWith('/developers');
    }
    return location.pathname === path;
  };

  return (
    <>
    <header data-tutorial="header" className={`border-b backdrop-blur-2xl sticky top-0 z-50 w-screen border-neutral-200 dark:border-neutral-800/50 bg-white/80 ${isMinePage ? 'dark:bg-gray-950/90' : 'theme-transition dark:bg-neutral-900/80'}`}>
      {/* Background decorative elements (clipped to header bounds) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 w-96 h-full bg-linear-to-r from-orange-500/5 dark:from-orange-500/10 to-transparent blur-3xl" />
        <div className="absolute top-0 right-0 w-96 h-full bg-linear-to-l from-purple-500/5 dark:from-purple-500/10 to-transparent blur-3xl" />
      </div>

      {/* Animated gradient line on top */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-linear-to-r from-transparent via-orange-500 to-transparent opacity-50" />

      <div className="max-w-450 mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-14 lg:h-14 flex items-stretch justify-between relative z-10">
        <div className="flex items-stretch gap-2 sm:gap-4 lg:gap-6">
          {/* Logo with enhanced effects - entire block is clickable */}
          <button onClick={() => { showDesktop(); window.dispatchEvent(new Event('close-wallet-panel')); }} className="flex items-center gap-2 sm:gap-4 lg:gap-6 group cursor-pointer">
            <div className="relative">
              <img
                src={logoUrl}
                alt="Logo"
                className="relative z-10 w-7 h-7 sm:w-9 sm:h-9 lg:w-11 lg:h-11 transition-transform duration-200 group-hover:scale-110 group-hover:rotate-6"
              />
            </div>

            <div className="relative text-left">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h1 className="text-base sm:text-lg lg:text-xl bg-clip-text text-neutral-900 dark:text-white">AgentSphere</h1>
                <span className="px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30 font-medium">
                  beta
                </span>
{isMock() && (
                  <span className="px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30">
                    DEMO
                  </span>
                )}
              </div>
              <p className="text-[10px] sm:text-xs text-neutral-500 dark:text-neutral-400">Agentic AI Marketplaces</p>

              {/* Decorative underline */}
              <div className="absolute -bottom-1 left-0 w-16 sm:w-20 h-0.5 bg-linear-to-r from-orange-500 to-transparent rounded-full" />
            </div>
          </button>

          {/* Navigation Tabs - next to logo */}
          <nav className="hidden lg:flex items-center h-full ml-8 gap-1">
            {navItems.map((item) => (
              item.external ? (
                <a
                  key={item.label}
                  href={item.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative px-5 py-2.5 flex items-center text-sm font-medium transition-colors duration-300 group"
                >
                  <span className="relative transition-colors duration-300 text-neutral-500 dark:text-neutral-400 group-hover:text-neutral-700 dark:group-hover:text-neutral-300">
                    {item.label}
                  </span>
                </a>
              ) : (
                <Link
                  key={item.label}
                  to={item.path}
                  className="relative px-5 py-2.5 flex items-center text-sm font-medium transition-colors duration-300 group"
                >
                  {/* Active indicator - line at header bottom edge */}
                  <AnimatePresence mode="wait">
                    {isActive(item.path) && (
                      <motion.span
                        key={item.path}
                        initial={{ scaleX: 0, opacity: 0 }}
                        animate={{ scaleX: 1, opacity: 1 }}
                        exit={{ scaleX: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="absolute left-0 right-0 -bottom-2 h-0.5 bg-linear-to-r from-orange-400 via-orange-500 to-amber-500 origin-center"
                      />
                    )}
                  </AnimatePresence>
                  {/* Text */}
                  <span className={`relative transition-colors duration-300 ${
                    isActive(item.path)
                      ? 'text-neutral-900 dark:text-white'
                      : 'text-neutral-500 dark:text-neutral-400 group-hover:text-neutral-700 dark:group-hover:text-neutral-300'
                  }`}>
                    {item.label}
                  </span>
                </Link>
              )
            ))}
          </nav>
        </div>

        {/* Dev Mode Banner - only shown when non-default settings are active */}
        {(devConfig.aggregatorUrl || devConfig.skipTrustBase) && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-orange-500/10 border border-orange-500/30 text-[10px] sm:text-xs font-mono">
            <span className="text-orange-500 font-semibold">DEV</span>
            <span className="text-orange-400/80 hidden sm:inline">
              {devConfig.aggregatorUrl && (
                <span title={devConfig.aggregatorUrl}>
                  {getHostname(devConfig.aggregatorUrl)}
                </span>
              )}
              {devConfig.aggregatorUrl && devConfig.skipTrustBase && " | "}
              {devConfig.skipTrustBase && "TB:OFF"}
            </span>
            <button
              onClick={devReset}
              className="ml-1 px-1.5 py-0.5 rounded bg-orange-500/20 hover:bg-orange-500/30 text-orange-500 font-semibold transition-colors"
              title="Reset dev settings to production defaults"
            >
              RESET
            </button>
          </div>
        )}

        <div className="flex items-center gap-1 sm:gap-2 lg:gap-3">
          {/* IPFS Sync Status */}
          <IpfsSyncIndicator />

          {/* Social Links */}
          <motion.a
            href="https://github.com/unicitynetwork"
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.05 }}
            className="relative p-2 sm:p-2.5 lg:p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg sm:rounded-xl transition-all group"
          >
            <Github className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-500 dark:text-neutral-400 group-hover:text-orange-400 transition-colors" />
            <div className="absolute inset-0 rounded-lg sm:rounded-xl bg-orange-500/0 group-hover:bg-orange-500/10 transition-colors" />
          </motion.a>

          <motion.a
            href="https://discord.gg/S9f57ZKdt"
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.05 }}
            className="relative p-2 sm:p-2.5 lg:p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg sm:rounded-xl transition-all group"
          >
            <DiscordIcon className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-500 dark:text-neutral-400 group-hover:text-orange-400 transition-colors" />
            <div className="absolute inset-0 rounded-lg sm:rounded-xl bg-orange-500/0 group-hover:bg-orange-500/10 transition-colors" />
          </motion.a>

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg transition-all"
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
            ) : (
              <Menu className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
            )}
          </button>
        </div>
      </div>

      {/* Bottom gradient line */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-linear-to-r from-transparent via-neutral-300 dark:via-neutral-700 to-transparent" />
    </header>

    {/* Mobile Menu - overlay */}
    <AnimatePresence>
      {mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden fixed inset-0 top-14 bg-black/20 backdrop-blur-sm z-40"
          />
          {/* Menu */}
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
            className="lg:hidden fixed left-0 right-0 top-14 backdrop-blur-xl border-b z-50 shadow-xl overflow-hidden bg-white/95 dark:bg-neutral-900/95 border-neutral-200 dark:border-neutral-800"
          >
          <nav className="px-4 py-3 space-y-1">
            {navItems.map((item) => (
              item.external ? (
                <a
                  key={item.label}
                  href={item.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full flex items-center px-4 py-3 rounded-xl text-base font-medium transition-all text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {item.label}
                </a>
              ) : (
                <button
                  key={item.label}
                  onClick={() => handleMobileNavigation(item.path)}
                  className={`relative w-full flex items-center px-4 py-3 rounded-xl text-base font-medium transition-all text-left ${
                    isActive(item.path)
                      ? 'text-neutral-900 dark:text-white'
                      : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  {/* Active indicator - vertical line on left edge */}
                  {isActive(item.path) && (
                    <motion.span
                      initial={{ scaleY: 0, opacity: 0 }}
                      animate={{ scaleY: 1, opacity: 1 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className="absolute left-0 top-2 bottom-2 w-0.5 bg-linear-to-b from-orange-400 via-orange-500 to-amber-500 origin-center rounded-full"
                    />
                  )}
                  {item.label}
                </button>
              )
            ))}

          </nav>
        </motion.div>
        </>
      )}
    </AnimatePresence>

    </>
  );
}
