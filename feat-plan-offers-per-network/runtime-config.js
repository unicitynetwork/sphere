// Default runtime config for dev / GitHub Pages builds: empty, so values
// fall back to the VITE_* env baked at build time (src/config/subscription.ts).
// In the Docker image this file is OVERWRITTEN at container start by
// deploy/runtime-config.sh from the container env — that's what makes the
// build-once image's feature flags swappable per environment. Loaded as a
// classic script BEFORE the app bundle (src/index.html), so the values are
// visible at module-init time.
window.__SPHERE_RUNTIME_CONFIG__ = {};
