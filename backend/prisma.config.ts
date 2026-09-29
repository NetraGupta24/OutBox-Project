import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // `prisma generate` runs on npm install, before .env exists, and doesn't
    // need a connection. Migrate commands fail clearly if this is empty.
    url: process.env.DATABASE_URL ?? '',
  },
});
