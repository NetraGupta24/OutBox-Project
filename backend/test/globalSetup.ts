import { execSync } from 'node:child_process';
import { Redis } from 'ioredis';
import type { TestProject } from 'vitest/node';

// Creates/migrates the test database and empties the test Redis database.
export default async function setup(project: TestProject) {
  const env = project.config.env as Record<string, string>;
  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
      stdio: 'pipe',
    });
  } catch (err) {
    const output = String((err as { stderr?: Buffer }).stderr ?? err);
    throw new Error(
      `Could not prepare the test database. Is MySQL running (npm run infra:up)?\n${output}`,
    );
  }
  const redis = new Redis(env.REDIS_URL!);
  await redis.flushdb();
  await redis.quit();
}
