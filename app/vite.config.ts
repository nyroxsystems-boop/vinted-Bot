import { defineConfig } from 'vite';

// The Tauri app's frontend is a tiny splash / services-console page.
// The real dashboard runs as its own Vite dev server on 5173 and is opened
// in a second window by the Rust side once the orchestrator is up.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0',
  },
  build: {
    target: 'es2021',
    sourcemap: true,
    minify: false,
    outDir: 'dist',
  },
});
