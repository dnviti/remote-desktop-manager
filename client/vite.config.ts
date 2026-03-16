import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Allow overriding proxy targets via env vars (set by Docker Compose).
// Defaults work for host-mode development (server on localhost).
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3001';
const guacTarget = process.env.VITE_GUAC_TARGET || 'http://localhost:3002';

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
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': [
            'react',
            'react-dom',
            'react-router-dom',
            'react-router',
          ],
          'vendor-mui': [
            '@mui/material',
            '@emotion/react',
            '@emotion/styled',
          ],
          'vendor-mui-icons': ['@mui/icons-material'],
          'vendor-terminal': ['@xterm/xterm', '@xterm/addon-fit'],
          'vendor-guacamole': ['@glokon/guacamole-common-js'],
          'vendor-network': ['axios', 'socket.io-client'],
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/socket.io': {
        target: apiTarget,
        ws: true,
      },
      '/guacamole': {
        target: guacTarget,
        ws: true,
        rewrite: (path) => path.replace(/^\/guacamole/, ''),
      },
    },
  },
});
