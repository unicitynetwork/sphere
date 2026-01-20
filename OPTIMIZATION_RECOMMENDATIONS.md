# Bundle Size Optimization Recommendations

## Executive Summary

Current main bundle: **4.04 MB** (1.15 MB gzipped)
Target: **< 500 KB initial load** (< 150 KB gzipped)
Estimated reduction: **~3.5 MB (87% reduction)**

---

## 1. LAZY LOAD IPFS/HELIA (~60MB → Load on L3 Access Only)

**Impact**: ⭐⭐⭐⭐⭐ (Highest Priority)
**Effort**: Medium
**Estimated Reduction**: ~3 MB from initial bundle

### Problem
The entire IPFS/Helia ecosystem (~60MB in node_modules) is loaded upfront because `IpfsStorageService` is statically imported through `ServicesProvider` → `IdentityManager` chain.

### Solution: Create Lazy-Loaded IPFS Module

**Step 1: Create an IPFS Lazy Loader**

```typescript
// src/components/wallet/L3/services/IpfsLoader.ts
let ipfsStorageService: any = null;
let loadingPromise: Promise<any> | null = null;

export async function getIpfsStorageService() {
  if (ipfsStorageService) {
    return ipfsStorageService;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    console.log("📦 Lazy loading IPFS storage service...");
    const { IpfsStorageService } = await import('./IpfsStorageService');
    ipfsStorageService = IpfsStorageService.getInstance();
    return ipfsStorageService;
  })();

  return loadingPromise;
}

export function isIpfsLoaded(): boolean {
  return ipfsStorageService !== null;
}
```

**Step 2: Update useIpfsStorage Hook**

```typescript
// src/components/wallet/L3/hooks/useIpfsStorage.ts
import { useState, useEffect, useCallback } from 'react';
import { getIpfsStorageService, isIpfsLoaded } from '../services/IpfsLoader';

export function useIpfsStorage() {
  const [ipfsService, setIpfsService] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEnabled, setIsEnabled] = useState(() =>
    import.meta.env.VITE_ENABLE_IPFS === 'true'
  );

  // Lazy load IPFS when hook is first used
  useEffect(() => {
    if (!isEnabled || isIpfsLoaded()) {
      setIpfsService(isIpfsLoaded() ? getIpfsStorageService() : null);
      return;
    }

    setIsLoading(true);
    getIpfsStorageService()
      .then((service) => {
        setIpfsService(service);
        setIsLoading(false);
      })
      .catch((error) => {
        console.error('Failed to load IPFS service:', error);
        setIsLoading(false);
      });
  }, [isEnabled]);

  // ... rest of hook implementation
}
```

**Step 3: Remove Static IPFS Imports from IdentityManager**

```typescript
// src/components/wallet/L3/services/IdentityManager.ts
// BEFORE:
import { IpfsStorageService } from './IpfsStorageService';

// AFTER:
// Remove the import - IPFS will be loaded only when useIpfsStorage() is called
```

**Step 4: Update L3WalletView to Show Loading State**

```typescript
// src/components/wallet/L3/views/L3WalletView.tsx
export function L3WalletView({ showBalances }: { showBalances: boolean }) {
  const {
    exportTxf,
    importTxf,
    isExportingTxf,
    isImportingTxf,
    isSyncing,
    isEnabled: isIpfsEnabled,
    isLoading: isIpfsLoading  // New loading state
  } = useIpfsStorage();

  // Show IPFS loading indicator
  if (isIpfsEnabled && isIpfsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
        <span className="ml-2">Loading IPFS sync...</span>
      </div>
    );
  }

  // ... rest of component
}
```

---

## 2. LAZY LOAD L1/L3 WALLET VIEWS (Route-Based Splitting)

**Impact**: ⭐⭐⭐⭐ (High Priority)
**Effort**: Low
**Estimated Reduction**: ~200 KB from initial bundle

### Problem
Both L1 and L3 wallet views are imported in `WalletPanel`, but only one is visible at a time.

### Solution: Dynamic Imports with Suspense

```typescript
// src/components/wallet/WalletPanel.tsx
import { Suspense, lazy } from 'react';

// Lazy load wallet views
const L1WalletView = lazy(() => import('./L1/views/L1WalletView').then(m => ({ default: m.L1WalletView })));
const L3WalletView = lazy(() => import('./L3/views/L3WalletView').then(m => ({ default: m.L3WalletView })));

export function WalletPanel() {
  // ... existing state

  return (
    <div className="flex-1 relative overflow-hidden">
      <Suspense fallback={
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      }>
        <motion.div
          className="absolute inset-0"
          style={{ pointerEvents: activeLayer === 'L1' ? 'auto' : 'none' }}
        >
          {activeLayer === 'L1' && <L1WalletView showBalances={showBalances} />}
        </motion.div>
        <motion.div
          className="absolute inset-0"
          style={{ pointerEvents: activeLayer === 'L3' ? 'auto' : 'none' }}
        >
          {activeLayer === 'L3' && <L3WalletView showBalances={showBalances} />}
        </motion.div>
      </Suspense>
    </div>
  );
}
```

---

## 3. LAZY LOAD KATEX (Already Implemented ✓)

**Status**: ✅ **Already Optimized**
**Impact**: ⭐⭐ (Medium - but already done)

KaTeX is dynamically imported in `src/utils/markdown.tsx`:

```typescript
import('katex').then((katex) => {
  const rendered = katex.default.renderToString(latex, { ... });
});
```

This is good! KaTeX (265 KB) is already code-split and only loaded when markdown with LaTeX is rendered.

---

## 4. REMOVE UNUSED DEPENDENCIES

**Impact**: ⭐⭐⭐ (Medium Priority)
**Effort**: Low
**Estimated Reduction**: ~50 KB

### 4.1 Remove "latest" Package

```bash
npm uninstall latest
```

**Reason**: The package `latest` is listed in dependencies but appears unused. This is likely a mistake from running `npm install latest` instead of `npm install package@latest`.

### 4.2 Audit webcrypto-liner

```bash
# Search for usage
grep -r "webcrypto-liner" src/
```

If unused, remove it:
```bash
npm uninstall webcrypto-liner
```

**Reason**: `webcrypto-liner` is a polyfill for WebCrypto API. Modern browsers have native WebCrypto support. Only needed if supporting very old browsers.

---

## 5. OPTIMIZE FRAMER-MOTION (Tree-Shaking)

**Impact**: ⭐⭐ (Low-Medium Priority)
**Effort**: Medium
**Estimated Reduction**: ~100 KB

### Problem
Framer Motion is used in **49 files** but may not be tree-shaken properly.

### Solution: Import Only What You Need

**Before:**
```typescript
import { motion } from 'framer-motion';
```

**After:**
```typescript
import { motion } from 'framer-motion/dist/framer-motion';
```

Or use more specific imports if available. However, Framer Motion 12 has improved tree-shaking, so this may have minimal impact.

### Alternative: Consider Lighter Animation Library

If only using basic animations, consider replacing with:
- **react-spring** (smaller, physics-based)
- **CSS transitions** (zero JS bundle cost)

---

## 6. LAZY LOAD AGENT CHAT COMPONENTS

**Impact**: ⭐⭐⭐ (Medium Priority)
**Effort**: Low
**Estimated Reduction**: ~150 KB

### Problem
All agent chat components are imported statically in `AgentPage.tsx`:

```typescript
import { ChatSection } from '../components/chat/ChatSection';
import { SportChat } from '../components/agents/SportChat';
import { P2PChat } from '../components/agents/P2PChat';
import { MerchChat } from '../components/agents/MerchChat';
import { TriviaChat } from '../components/agents/TriviaChat';
import { GamesChat } from '../components/agents/GamesChat';
import { AIChat } from '../components/agents/AIChat';
```

### Solution: Dynamic Import Based on Agent ID

```typescript
// src/pages/AgentPage.tsx
import { lazy, Suspense } from 'react';

// Lazy load all agent components
const ChatSection = lazy(() => import('../components/chat/ChatSection').then(m => ({ default: m.ChatSection })));
const AIChat = lazy(() => import('../components/agents/AIChat').then(m => ({ default: m.AIChat })));
const TriviaChat = lazy(() => import('../components/agents/TriviaChat').then(m => ({ default: m.TriviaChat })));
const GamesChat = lazy(() => import('../components/agents/GamesChat').then(m => ({ default: m.GamesChat })));
const SportChat = lazy(() => import('../components/agents/SportChat').then(m => ({ default: m.SportChat })));
const P2PChat = lazy(() => import('../components/agents/P2PChat').then(m => ({ default: m.P2PChat })));
const MerchChat = lazy(() => import('../components/agents/MerchChat').then(m => ({ default: m.MerchChat })));

export function AgentPage() {
  // ... existing code

  const renderChatComponent = () => {
    const ChatComponent = (() => {
      switch (currentAgent.id) {
        case 'chat': return ChatSection;
        case 'ai': return AIChat;
        case 'trivia': return TriviaChat;
        case 'games': return GamesChat;
        case 'sport': return SportChat;
        case 'p2p': return P2PChat;
        case 'merch': return MerchChat;
        default: return ChatSection;
      }
    })();

    return (
      <Suspense fallback={
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
        </div>
      }>
        <ChatComponent agent={currentAgent} />
      </Suspense>
    );
  };

  // ... rest of component
}
```

---

## 7. CONFIGURE VITE FOR MANUAL CHUNKING

**Impact**: ⭐⭐⭐⭐ (High Priority)
**Effort**: Low
**Estimated Reduction**: Better caching, not size reduction

### Solution: Update vite.config.ts

```typescript
// vite.config.ts
export default defineConfig(({ mode }) => {
  // ... existing config

  return {
    // ... existing plugins

    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // Core React libraries
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],

            // TanStack Query
            'vendor-query': ['@tanstack/react-query'],

            // Crypto libraries (L1 wallet)
            'vendor-crypto': ['elliptic', 'bip39', 'crypto-js', 'asmcrypto.js'],

            // Unicity SDK (L3 wallet)
            'vendor-unicity': [
              '@unicitylabs/state-transition-sdk',
              '@unicitylabs/nostr-js-sdk'
            ],

            // IPFS/Helia (lazy loaded, but chunk separately when loaded)
            'vendor-ipfs': [
              'helia',
              '@helia/ipns',
              '@helia/json'
            ],

            // UI libraries
            'vendor-ui': ['framer-motion', 'lucide-react'],

            // Analytics
            'vendor-analytics': ['mixpanel-browser'],
          }
        }
      },
      chunkSizeWarningLimit: 600, // Increase limit to 600KB for vendor chunks
    }
  };
});
```

---

## 8. DEFER MIXPANEL INITIALIZATION

**Impact**: ⭐⭐ (Low-Medium Priority)
**Effort**: Low
**Estimated Reduction**: ~50 KB from initial parse/execute time

### Problem
Mixpanel initializes immediately in `main.tsx`:

```typescript
mixpanel.init('19d06212425213a4eeb34337016d0186', {
  autocapture: true,
  record_sessions_percent: 100,
});
```

### Solution: Lazy Load Analytics

```typescript
// src/utils/analytics.ts
let mixpanel: any = null;

export async function initAnalytics() {
  if (mixpanel) return mixpanel;

  const mp = await import('mixpanel-browser');
  mp.default.init('19d06212425213a4eeb34337016d0186', {
    autocapture: true,
    record_sessions_percent: 100,
    api_host: 'https://api-eu.mixpanel.com',
  });
  mixpanel = mp.default;
  return mixpanel;
}

export function trackEvent(event: string, properties?: any) {
  if (mixpanel) {
    mixpanel.track(event, properties);
  } else {
    // Queue event if analytics not loaded yet
    queuedEvents.push({ event, properties });
  }
}

let queuedEvents: any[] = [];

// Initialize after first interaction or timeout
export function lazyInitAnalytics() {
  setTimeout(() => {
    initAnalytics().then(() => {
      // Flush queued events
      queuedEvents.forEach(({ event, properties }) => {
        mixpanel.track(event, properties);
      });
      queuedEvents = [];
    });
  }, 2000); // Wait 2s after page load
}
```

```typescript
// src/main.tsx
import { lazyInitAnalytics } from './utils/analytics';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* ... */}
  </StrictMode>,
);

// Initialize analytics after render
lazyInitAnalytics();
```

---

## 9. OPTIMIZE QR CODE LIBRARY

**Impact**: ⭐ (Low Priority)
**Effort**: Low
**Estimated Reduction**: ~20 KB

### Current: qr-code-styling (Heavy with styling)
### Alternative: qrcode (Lightweight)

```bash
npm uninstall qr-code-styling
npm install qrcode
```

Then update QR code generation code to use the lighter library.

---

## 10. ENABLE GZIP/BROTLI COMPRESSION (Server-Side)

**Impact**: ⭐⭐⭐⭐ (High Priority - but server config)
**Effort**: Low (depends on hosting)
**Result**: ~70% size reduction on the wire

Ensure your hosting (Vercel, Netlify, etc.) serves files with Brotli compression. Most modern hosts do this automatically, but verify:

```bash
# Test compression
curl -H "Accept-Encoding: br" https://your-domain.com/assets/index-*.js -I
```

Should return: `Content-Encoding: br`

---

## IMPLEMENTATION PRIORITY

### Phase 1: Immediate Impact (Week 1)
1. ✅ **Lazy load IPFS/Helia** (~3 MB reduction) - HIGHEST IMPACT
2. ✅ **Remove unused dependencies** (`latest`, possibly `webcrypto-liner`)
3. ✅ **Lazy load L1/L3 wallet views**
4. ✅ **Configure Vite manual chunks**

### Phase 2: Quick Wins (Week 2)
5. ✅ **Lazy load agent chat components**
6. ✅ **Defer Mixpanel initialization**

### Phase 3: Polish (Week 3)
7. ✅ **Optimize QR code library**
8. ✅ **Review Framer Motion usage**

---

## EXPECTED RESULTS

| Current | After Phase 1 | After Phase 2 | After Phase 3 |
|---------|---------------|---------------|---------------|
| 4.04 MB | ~800 KB | ~600 KB | ~500 KB |
| 1.15 MB gzipped | ~250 KB gzipped | ~180 KB gzipped | ~150 KB gzipped |

**Initial page load time improvement: 70-85% reduction**

---

## MEASURING SUCCESS

### Before Optimization
```bash
npm run build
# Check: dist/assets/index-*.js size
```

### After Each Phase
```bash
npm run build
ls -lh dist/assets/index-*.js
# Compare sizes
```

### Lighthouse Audit
```bash
npx lighthouse https://your-domain.com --view
```

Target metrics:
- **First Contentful Paint (FCP)**: < 1.8s
- **Time to Interactive (TTI)**: < 3.8s
- **Total Blocking Time (TBT)**: < 200ms

---

## NOTES

1. **IPFS lazy loading is critical** - This single change will have the biggest impact (~3MB reduction)
2. **Route-based code splitting** helps users download only what they need
3. **Manual chunking** improves caching - vendor chunks don't change often
4. **Analytics/telemetry** should always be lazy loaded - not critical for initial render
5. **Consider service workers** for caching static assets (future enhancement)

---

## TESTING CHECKLIST

After implementing optimizations:

- [ ] L1 wallet loads without IPFS
- [ ] L3 wallet lazy loads IPFS on first access
- [ ] Agent switching loads components on demand
- [ ] Initial page load is < 1s on 4G
- [ ] No console errors from dynamic imports
- [ ] Wallet functionality works correctly
- [ ] IPFS sync works after lazy load
- [ ] Bundle size reduced by > 70%

