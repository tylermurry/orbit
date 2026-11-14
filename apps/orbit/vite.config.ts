import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { outDir: 'dist', target: 'es2022', sourcemap: false },
});
