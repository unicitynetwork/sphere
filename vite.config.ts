import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import fs from 'fs';
import path from 'path';

// SSL certificate paths for HTTPS (copied from Let's Encrypt)
const SSL_CERT_PATH = '/home/vrogojin/certs';

// Check if SSL certificates exist
const sslEnabled = fs.existsSync(path.join(SSL_CERT_PATH, 'fullchain.pem')) &&
                   fs.existsSync(path.join(SSL_CERT_PATH, 'privkey.pem'));

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      protocolImports: true,
    }),
  ],
  base: process.env.BASE_PATH || '/',
  server: {
    // Enable HTTPS if certificates are available
    https: sslEnabled ? {
      key: fs.readFileSync(path.join(SSL_CERT_PATH, 'privkey.pem')),
      cert: fs.readFileSync(path.join(SSL_CERT_PATH, 'fullchain.pem')),
    } : undefined,
    // Allow external connections
    host: '0.0.0.0',
    // Configure HMR WebSocket to use the correct host
    hmr: {
      host: 'sphere-test.dyndns.org',
      protocol: 'wss',
    },
    proxy: {
      '/rpc': {
        target: 'https://goggregator-test.unicity.network',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/rpc/, ''),
      }
    }
  }
})
