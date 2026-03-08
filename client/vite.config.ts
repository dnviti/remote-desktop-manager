import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Allow overriding proxy targets via env vars (set by Docker Compose).
// Defaults work for host-mode development (server on localhost).
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3001';
const guacTarget = process.env.VITE_GUAC_TARGET || 'http://localhost:3002';

export default defineConfig({
  plugins: [react()],
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
