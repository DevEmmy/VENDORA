import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendProxy = {
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
};

export default defineConfig({
  plugins: [react()],

  // Supports local preview, GitHub Pages, and Render.
  base: process.env.VITE_BASE || './',

  server: {
    proxy: backendProxy,
  },

  preview: {
    port: 4173,
    proxy: backendProxy,
  },
});