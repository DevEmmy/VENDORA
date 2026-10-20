import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',

  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: false,
      },
      '/wema': {
        target: 'http://localhost:8080',
        changeOrigin: false,
      },
      '/whatsapp': {
        target: 'http://localhost:8080',
        changeOrigin: false,
      },
    },
  },

  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: false,
      },
      '/wema': {
        target: 'http://localhost:8080',
        changeOrigin: false,
      },
      '/whatsapp': {
        target: 'http://localhost:8080',
        changeOrigin: false,
      },
    },
  },
});