import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative paths work everywhere: GitHub Pages (/VENDORA/), Render (root) and local preview.
  base: process.env.VITE_BASE || './',

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
});
