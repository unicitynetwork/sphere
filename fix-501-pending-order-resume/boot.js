/**
 * Pre-React boot work, in a file rather than inline in index.html.
 *
 * Both of these have to run before the module bundle, and both used to be inline
 * <script> blocks. Inline script is exactly what a Content-Security-Policy cannot
 * distinguish from an injected one, so allowing it would make `script-src 'self'`
 * meaningless on an origin that holds a mnemonic seed. A same-origin classic script
 * achieves the same ordering — /runtime-config.js already proves that — with no
 * 'unsafe-inline' allowance and no hash to keep in sync.
 *
 * Nonces would be the other option and are the wrong tool here: this repo builds one
 * image and promotes it, so a build-time nonce is identical across environments, and
 * the GitHub Pages deployment can never have a per-request one.
 *
 * Keep this file dependency-free and synchronous. It is a classic script, not a module.
 */
(function () {
  // ── GitHub Pages SPA path restore ────────────────────────────────────────
  // The root 404.html redirects deep links from /base/{route}?qs to
  // /base/?p=/{route}&qs; rewrite back before React Router reads the URL.
  // No-op in production, where no ?p= is present.
  var params = new URLSearchParams(window.location.search);
  var p = params.get('p');
  if (p) {
    params.delete('p');
    var base = window.location.pathname.replace(/\/$/, '');
    var remaining = params.toString();
    window.history.replaceState(
      null,
      '',
      base + p + (remaining ? '?' + remaining : '') + window.location.hash
    );
  }

  // ── Theme, applied before first paint ────────────────────────────────────
  // Unconditionally dark. The app IS dark-only: useTheme.getStoredTheme() returns
  // 'dark' on every path and migrates any stored 'light' away on module load.
  //
  // This used to read localStorage('sphere-theme') and fall back to
  // prefers-color-scheme. Two bugs in one: the key was hyphenated while every writer
  // uses STORAGE_KEYS.THEME ('sphere_theme'), so the lookup always missed — and the
  // matchMedia fallback then applied `light` on a light-preferring machine, which
  // React immediately overwrote with `dark`. That flash was the very thing the guard
  // existed to prevent. Restore the storage read only if a light theme comes back.
  document.documentElement.classList.add('dark');
})();
