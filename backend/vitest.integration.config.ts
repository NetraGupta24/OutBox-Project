import { defineConfig } from 'vitest/config';

// Integration tests run against the docker-compose MySQL and Redis, using a
// separate database (reachinbox_test) and Redis database 15, so they never
// touch development data. Start the services first: npm run infra:up
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'mysql://reachinbox:reachinbox@localhost:3306/reachinbox_test',
      ELASTICSEARCH_INDEX: 'emails_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
      ENCRYPTION_KEY: '1'.repeat(64),
      JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-characters',
      FRONTEND_URL: 'http://localhost:3000',
      GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      SLACK_CLIENT_ID: 'test-slack-client',
      SLACK_CLIENT_SECRET: 'test-slack-secret',
      MIN_SEND_INTERVAL_MS: '2000',
      MAX_EMAILS_PER_HOUR_PER_SENDER: '200',
      RATE_LIMIT_WINDOW_MS: '3600000',
    },
  },
});
