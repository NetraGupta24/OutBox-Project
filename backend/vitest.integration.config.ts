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
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
      ENCRYPTION_KEY: '1'.repeat(64),
      MIN_SEND_INTERVAL_MS: '2000',
      MAX_EMAILS_PER_HOUR_PER_SENDER: '200',
      RATE_LIMIT_WINDOW_MS: '3600000',
    },
  },
});
