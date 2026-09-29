/**
 * Rebuilds the Elasticsearch index from MySQL (the source of truth).
 *
 *   npm run search:reindex -w backend              index every email
 *   npm run search:reindex -w backend -- --fresh   delete and recreate the index first
 */
import { prisma } from '../lib/prisma.js';
import { deleteEmailIndex, ensureEmailIndex, indexEmails } from '../modules/search/emailIndex.js';

const BATCH = 1000;

async function main() {
  if (process.argv.includes('--fresh')) {
    await deleteEmailIndex();
    console.log('Deleted the search index');
  }
  await ensureEmailIndex();

  let cursor = 0;
  let total = 0;
  for (;;) {
    const ids = (
      await prisma.email.findMany({
        where: { id: { gt: cursor } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH,
      })
    ).map((row) => row.id);
    if (ids.length === 0) break;
    total += await indexEmails(ids);
    cursor = ids[ids.length - 1]!;
    console.log(`  indexed ${total} email(s)`);
  }
  console.log(`Done: ${total} email(s) in the search index`);
}

main()
  .catch((err) => {
    console.error('Reindex failed:', (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
