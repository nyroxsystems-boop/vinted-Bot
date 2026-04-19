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
    host: '0.0.0.0',
    port: DASHBOARD_PORT,
    proxy: {
      '/api': { target: ORCHESTRATOR_URL, changeOrigin: true },
      '/stream': { target: ORCHESTRATOR_URL, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: DASHBOARD_PORT,
    proxy: {
      '/api': { target: ORCHESTRATOR_URL, changeOrigin: true },
      '/stream': { target: ORCHESTRATOR_URL, changeOrigin: true },
    },
  },
});
