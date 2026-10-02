import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70
      },
      include: ['db.js', 'validation.js', 'server.js'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'coverage/**',
        'Enterprise/agent/**',
        'Enterprise/portal/**',
        'tests/**',
        'test-*.js'
      ]
    }
  }
});
