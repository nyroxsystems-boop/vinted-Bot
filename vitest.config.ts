import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.tmp/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.config.{ts,js,cjs}',
        '**/scripts/**',
      ],
    },
  },
});
