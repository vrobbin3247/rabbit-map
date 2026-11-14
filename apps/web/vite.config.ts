import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // changeOrigin makes the Host header 127.0.0.1:8787, which the server's Host guard requires.
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  test: { name: 'web', environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'] },
});
