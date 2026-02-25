import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/guacamole': {
        target: 'http://localhost:3002',
        ws: true,
        rewrite: (path) => path.replace(/^\/guacamole/, ''),
      },
    },
  },
});
