import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import fs from 'fs';
import path from 'path';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` (development, production, etc.)
  const env = loadEnv(mode, process.cwd(), '');

  // SSL certificate path from .env (optional - leave empty to disable HTTPS)
  const sslCertPath = env.SSL_CERT_PATH || '';

  // Check if SSL certificates exist (only if path is configured)
  const sslEnabled = sslCertPath &&
                     fs.existsSync(path.join(sslCertPath, 'fullchain.pem')) &&
                     fs.existsSync(path.join(sslCertPath, 'privkey.pem'));

  // HMR host from .env (optional - for remote development)
  const hmrHost = env.HMR_HOST || '';

  return {
    plugins: [
      react(),
      tailwindcss(),
      nodePolyfills({
        protocolImports: true,
        globals: {
          Buffer: 'build',
        },
      }),
    ],
    base: env.BASE_PATH || '/',
    resolve: {
      alias: [
        // Resolve sphere-sdk from source (TypeScript) to avoid pre-built dist issues
        { find: /^@unicitylabs\/sphere-sdk$/, replacement: path.resolve(__dirname, '../sphere-sdk/index.ts') },
        { find: /^@unicitylabs\/sphere-sdk\/(.+)/, replacement: path.resolve(__dirname, '../sphere-sdk/$1') },
        // Ensure vite-plugin-node-polyfills shims resolve from sphere's node_modules
        // (needed because SDK source files are outside this project tree)
        { find: /^vite-plugin-node-polyfills\/shims\/(.+)/, replacement: path.resolve(__dirname, 'node_modules/vite-plugin-node-polyfills/shims/$1') },
      ],
    },
    server: {
      // Enable HTTPS if certificates are available
      https: sslEnabled ? {
        key: fs.readFileSync(path.join(sslCertPath, 'privkey.pem')),
        cert: fs.readFileSync(path.join(sslCertPath, 'fullchain.pem')),
      } : undefined,
      // Allow external connections
      host: '0.0.0.0',
      // Configure HMR WebSocket - use env var for custom host, or auto-detect
      hmr: hmrHost ? {
        host: hmrHost,
        protocol: sslEnabled ? 'wss' : 'ws',
      } : true,
      proxy: {
        '/rpc': {
          target: 'https://goggregator-test.unicity.network',
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/rpc/, ''),
        },
        '/dev-rpc': {
          target: 'https://dev-aggregator.dyndns.org',
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/dev-rpc/, ''),
        },
        '/coingecko': {
          target: 'https://api.coingecko.com/api/v3',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/coingecko/, ''),
        }
      }
    },
    // Pre-bundle heavy CJS dependencies to speed up dev server cold start
    // Note: ESM packages like @unicitylabs/* and helia/* don't need pre-bundling
    optimizeDeps: {
      include: [
        'buffer',
        'elliptic',
        'bip39',
        'crypto-js',
        'framer-motion',
        'react',
        'react-dom',
        'react-router-dom',
        '@tanstack/react-query',
      ],
    }
  };
});
