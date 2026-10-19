import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isProd = process.env.NODE_ENV === 'production';

export default defineConfig({
  plugins: [react()],
  base: isProd ? '/VENDORA/' : './',

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
