import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In containers: set ORCHESTRATOR_URL=https://your-orchestrator.example.com
// Locally: defaults to http://localhost:4700
const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ??
  `http://localhost:${process.env.ORCHESTRATOR_PORT ?? '4700'}`;

const DASHBOARD_PORT = Number.parseInt(
  process.env.PORT ?? process.env.DASHBOARD_PORT ?? '5173',
  10,
);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: DASHBOARD_PORT,
    proxy: {
      '/api': { target: ORCHESTRATOR_URL, changeOrigin: true },
      '/stream': { target: ORCHESTRATOR_URL, changeOrigin: true },
      '/auth': { target: ORCHESTRATOR_URL, changeOrigin: true },
      '/health': { target: ORCHESTRATOR_URL, changeOrigin: true },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: DASHBOARD_PORT,
    proxy: {
      '/api': { target: ORCHESTRATOR_URL, changeOrigin: true },
      '/stream': { target: ORCHESTRATOR_URL, changeOrigin: true },
      '/auth': { target: ORCHESTRATOR_URL, changeOrigin: true },
      '/health': { target: ORCHESTRATOR_URL, changeOrigin: true },
    },
  },
  esbuild: {
    // Strip console.* and debugger from production bundles. console.error and
    // console.warn stay — they surface real problems in shipped binaries.
    drop: ['debugger'],
    pure: ['console.log', 'console.info', 'console.debug', 'console.trace'],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    minify: 'esbuild',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react:    ['react', 'react-dom', 'react-router-dom'],
          icons:    ['lucide-react'],
          charts:   ['recharts'],
        },
      },
    },
  },
});
