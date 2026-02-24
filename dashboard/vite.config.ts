import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4173',
      '/ws': { target: 'http://localhost:4173', ws: true },
      '/health': 'http://localhost:4173',
      '/status': 'http://localhost:4173',
      '/onboard': 'http://localhost:4173',
    },
  },
});
