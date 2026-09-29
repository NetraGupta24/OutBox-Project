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
      JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-characters',
      FRONTEND_URL: 'http://localhost:3000',
      GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
    },
  },
});
