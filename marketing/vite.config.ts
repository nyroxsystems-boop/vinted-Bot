import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5181',
      '/downloads': 'http://localhost:5181',
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
