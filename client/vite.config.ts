import fs from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Allow overriding proxy targets via env vars (set by Docker Compose).
// Defaults work for host-mode development (server on localhost).
const apiTarget = process.env.VITE_API_TARGET || 'https://localhost:3001';
const guacTarget = process.env.VITE_GUAC_TARGET || 'https://localhost:3002';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'favicon.ico',
        'icon-192.png',
        'icon-512.png',
        'apple-touch-icon.png',
      ],
      manifest: {
        name: 'Arsenale',
        short_name: 'Arsenale',
        description:
          'Modern web-based remote access management platform for SSH, RDP, and VNC connections',
        theme_color: '#08080a',
        background_color: '#08080a',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icon-192-maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'New Connection',
            short_name: 'New Conn',
            description: 'Create a new SSH, RDP, or VNC connection',
            url: '/?action=new-connection',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Open Keychain',
            short_name: 'Keychain',
            description: 'Open the credential keychain and secrets manager',
            url: '/?action=open-keychain',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Open Settings',
            short_name: 'Settings',
            description: 'Open application settings and preferences',
            url: '/?action=open-settings',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        // Only cache static assets — never cache API calls or WebSocket connections
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MiB — main bundle exceeds default 2 MiB
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//, /^\/guacamole\//],
        runtimeCaching: [
          {
            // Navigation requests: online-first with fallback to cache
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 3,
            },
          },
          {
            // Static assets (JS, CSS, images, fonts): stale-while-revalidate
            urlPattern: ({ request }) =>
              request.destination === 'script' ||
              request.destination === 'style' ||
              request.destination === 'image' ||
              request.destination === 'font',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
            },
          },
          {
            // Google Fonts webfont files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@mui/material') || id.includes('node_modules/@emotion/')) {
            return 'vendor-mui';
          }
          if (id.includes('node_modules/@mui/icons-material')) {
            return 'vendor-mui-icons';
          }
          if (id.includes('node_modules/@xterm/')) {
            return 'vendor-terminal';
          }
          if (id.includes('node_modules/@glokon/guacamole-common-js')) {
            return 'vendor-guacamole';
          }
          if (id.includes('node_modules/axios') || id.includes('node_modules/socket.io-client')) {
            return 'vendor-network';
          }
        },
      },
    },
  },
  server: {
    port: 3000,
    https: (() => {
      // Use provided certs or fall back to auto-generated dev certs from the server
      const certPath = process.env.VITE_TLS_CERT || '../dev-certs/server/server-cert.pem';
      const keyPath = process.env.VITE_TLS_KEY || '../dev-certs/server/server-key.pem';
      try {
        return {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
        };
      } catch {
        // Certs not available yet — Vite will start without HTTPS.
        // Run the dev cert generation script first, or set VITE_TLS_CERT/KEY.
        return undefined as unknown as { cert: Buffer; key: Buffer };
      }
    })(),
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false, // accept self-signed certs from backend
      },
      '/socket.io': {
        target: apiTarget,
        ws: true,
        secure: false,
      },
      '/guacamole': {
        target: guacTarget,
        ws: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/guacamole/, ''),
      },
    },
  },
});
