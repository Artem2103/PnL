import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    // React changes on a release cadence; the card renderer changes on ours.
    // Splitting them lets a returning visitor reuse the larger half from cache.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client'],
        },
      },
    },
  },
});
