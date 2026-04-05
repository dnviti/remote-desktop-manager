import fs from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Allow overriding proxy targets via env vars (set by Docker Compose).
// Defaults target the local Go split services started by `make dev`.
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:18080';
const guacTarget = process.env.VITE_GUAC_TARGET || 'http://localhost:18091';
const terminalTarget = process.env.VITE_TERMINAL_TARGET || 'http://localhost:18090';
const devPort = Number(process.env.VITE_DEV_PORT || '3005');
const contentSecurityPolicy =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

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
        globIgnores: ['monaco/vs/**/*'],
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
        ],
      },
    }),
  ],
  build: {
    // Emit font files instead of inlining them as data: URLs so CSP can stay same-origin only.
    assetsInlineLimit: 0,
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
          if (id.includes('node_modules/axios')) {
            return 'vendor-network';
          }
        },
      },
    },
  },
  server: {
    port: devPort,
    headers: {
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      // NOTE: Vite dev server requires unsafe-inline/unsafe-eval for HMR to function.
      // This is acceptable in development only. Production builds use the client
      // nginx CSP with strict same-origin defaults.
      'Content-Security-Policy': contentSecurityPolicy,
    },
    fs: {
      // Restrict file serving to the project workspace only — prevents /@fs path traversal
      strict: true,
      // Primary defense: only allow serving files from client/ and hoisted node_modules
      allow: [
        '.',                    // client/ directory only
        '../node_modules',      // hoisted monorepo dependencies
      ],
      // Defense-in-depth: explicitly block sensitive files and non-client directories
      deny: [
        '.env',
        '.env.*',
        '.git/**',
        'node_modules/.vite/deps/_metadata.json',
        '**/*.pem',
        '**/*.key',
        // Block all non-client monorepo directories
        '../server/**',
        '../gateways/**',
        '../infrastructure/**',
        '../deployment/**',
        '../dev-certs/**',
        '../docs/**',
        '../tasks/**',
        '../.claude/**',
        // Block infrastructure files
        '../compose*.yml',
        '../docker-compose*.yml',
        '../Dockerfile*',
        '../.env*',
        '../*.sh',
      ],
    },
    https: (() => {
      // Use provided certs or fall back to the generated dev cert bundle.
      const certPath = process.env.VITE_TLS_CERT || '../dev-certs/control-plane-api/server-cert.pem';
      const keyPath = process.env.VITE_TLS_KEY || '../dev-certs/control-plane-api/server-key.pem';
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
      '/guacamole': {
        target: guacTarget,
        ws: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/guacamole/, ''),
      },
      '/ws/terminal': {
        target: terminalTarget,
        ws: true,
        secure: false,
      },
    },
  },
});
