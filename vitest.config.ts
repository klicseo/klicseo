import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // Legacy fixture suites exercise the rollback path; database-read suites opt in.
    env: { LEAD_DATABASE_READS: 'false' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './empty-module.js'),
    },
  },
});
