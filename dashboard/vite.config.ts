import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ORCHESTRATOR_PORT = process.env.ORCHESTRATOR_PORT ?? '4700';
const DASHBOARD_PORT = Number.parseInt(process.env.DASHBOARD_PORT ?? '5173', 10);

export default defineConfig({
  plugins: [react()],
  server: {
    port: DASHBOARD_PORT,
    proxy: {
      '/api': `http://localhost:${ORCHESTRATOR_PORT}`,
      '/stream': {
        target: `http://localhost:${ORCHESTRATOR_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
