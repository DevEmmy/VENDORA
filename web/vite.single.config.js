// Builds ONE self-contained file (dist-single/index.html) that opens directly from a phone or laptop, no server needed.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({ plugins: [react(), viteSingleFile()], base: './', build: { outDir: 'dist-single' } });
