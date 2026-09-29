import { defineConfig } from 'vitest/config';

// Unit tests: no database or Redis needed. The env values below only satisfy
// config validation; nothing connects to them.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'mysql://unit:unit@127.0.0.1:1/unit',
      REDIS_URL: 'redis://127.0.0.1:1',
      ENCRYPTION_KEY: '0'.repeat(64),
    },
  },
});
