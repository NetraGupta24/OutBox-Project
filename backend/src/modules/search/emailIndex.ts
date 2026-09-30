/**
 * Elasticsearch index of emails, for the dashboard's search box.
 *
 * MySQL stays the source of truth: the index is derived from it (see
 * queueSearchIndex / reindex script), and search results are loaded back from
 * MySQL, so a slightly stale index can only affect which rows match, never
 * what they show.
 */
import type { EmailStatus } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { es } from '../../lib/elasticsearch.js';
import { prisma } from '../../lib/prisma.js';

const INDEX = env.ELASTICSEARCH_INDEX;
const MAX_BODY_CHARS = 10_000;

let indexReady: Promise<void> | null = null;

// Creates the index with its mapping if it doesn't exist yet (once per process).
export function ensureEmailIndex(): Promise<void> {
  indexReady ??= (async () => {
    if (await es.indices.exists({ index: INDEX })) return;
    try {
      await es.indices.create({
        index: INDEX,
        settings: { number_of_shards: 1, number_of_replicas: 0 },
        mappings: {
          dynamic: 'strict',
          properties: {
            userId: { type: 'integer' },
            campaignId: { type: 'integer' },
            // search_as_you_type: "lead1" or "follo" match while typing.
            recipient: { type: 'search_as_you_type' },
            subject: { type: 'search_as_you_type' },
            body: { type: 'text' },
            senderEmail: { type: 'keyword' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
            updatedAt: { type: 'date' },
          },
        },
      });
    } catch (err) {
      // Another process created it first.
      if (!String((err as Error).message).includes('resource_already_exists_exception')) throw err;
    }
  })().catch((err) => {
    indexReady = null; // try again next time
    throw err;
  });
  return indexReady;
}

// Writes the current MySQL state of these emails to the index (deleting ones
// that no longer exist). Idempotent, so safe to retry.
export async function indexEmails(ids: number[], { refresh = false } = {}): Promise<number> {
  if (ids.length === 0) return 0;
  await ensureEmailIndex();

  const rows = await prisma.email.findMany({
    where: { id: { in: ids } },
    include: { campaign: { select: { bodyText: true } }, sender: { select: { email: true } } },
  });
  const found = new Set(rows.map((r) => r.id));

  const operations: object[] = [];
  for (const row of rows) {
    operations.push({ index: { _index: INDEX, _id: String(row.id) } });
    operations.push({
      userId: row.userId,
      campaignId: row.campaignId,
      recipient: row.recipient,
      subject: row.subject,
      body: row.campaign.bodyText.slice(0, MAX_BODY_CHARS),
      senderEmail: row.sender.email,
      status: row.status,
      scheduledAt: row.scheduledAt,
      sentAt: row.sentAt,
      updatedAt: row.updatedAt,
    });
  }
  for (const id of ids) {
    if (!found.has(id)) operations.push({ delete: { _index: INDEX, _id: String(id) } });
  }

  const result = await es.bulk({ operations, refresh: refresh ? 'wait_for' : false });
  if (result.errors) {
    const failed = result.items.filter((item) => {
      const op = item.index ?? item.delete;
      return op?.error && op.status !== 404;
    });
    if (failed.length) throw new Error(`Elasticsearch rejected ${failed.length} document(s)`);
  }
  return rows.length;
}

export type SearchOptions = {
  userId: number;
  statuses: readonly EmailStatus[];
  campaignId?: number;
  q: string;
  from: number;
  size: number;
  newestFirst: boolean;
};

// Matching email ids, best match first, then by date.
export async function searchEmailIds(
  opts: SearchOptions,
): Promise<{ ids: number[]; total: number }> {
  const result = await es.search<unknown>({
    index: INDEX,
    from: opts.from,
    size: opts.size,
    track_total_hits: true,
    _source: false,
    query: {
      bool: {
        filter: [
          { term: { userId: opts.userId } },
          { terms: { status: [...opts.statuses] } },
          ...(opts.campaignId ? [{ term: { campaignId: opts.campaignId } }] : []),
        ],
        must: [
          {
            multi_match: {
              query: opts.q,
              type: 'bool_prefix',
              operator: 'and',
              fields: [
                'recipient^3',
                'recipient._2gram',
                'recipient._3gram',
                'subject^2',
                'subject._2gram',
                'subject._3gram',
                'body',
              ],
            },
          },
        ],
      },
    },
    sort: [
      { _score: { order: 'desc' } },
      opts.newestFirst ? { updatedAt: { order: 'desc' } } : { scheduledAt: { order: 'asc' } },
    ],
  });
  const total = result.hits.total;
  return {
    ids: result.hits.hits.map((hit) => Number(hit._id)),
    total: typeof total === 'number' ? total : (total?.value ?? 0),
  };
}

export async function deleteEmailIndex(): Promise<void> {
  indexReady = null;
  await es.indices.delete({ index: INDEX, ignore_unavailable: true });
}
