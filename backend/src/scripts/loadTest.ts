/**
 * Load test for the rate limiter: N emails all due at the same moment.
 *
 *   npm run load-test -w backend
 *   npm run load-test -w backend -- --emails 3000 --senders 2 --campaigns 4 --workers 10
 *   npm run load-test -w backend -- --planned   (each campaign pre-spread by the planner,
 *                                                as the API does, then competing for senders)
 *
 * Every decision is made by the real Redis Lua script the worker uses, with
 * `--workers` reservations running in parallel. Only the clock is simulated,
 * so hours of sending are checked in seconds. Nothing is sent and no database
 * rows are created; the Redis keys it uses are removed at the end.
 */
import { parseArgs } from 'node:util';
import { redis } from '../lib/redis.js';
import { reserveSendSlot } from '../modules/rateLimit/rateLimiter.js';
import { planSchedule } from '../modules/campaigns/schedulePlanner.js';

const { values: args } = parseArgs({
  options: {
    emails: { type: 'string', default: '1000' },
    senders: { type: 'string', default: '1' },
    campaigns: { type: 'string', default: '3' },
    'sender-limit': { type: 'string', default: '200' },
    'campaign-limit': { type: 'string', default: '200' },
    interval: { type: 'string', default: '2000' },
    workers: { type: 'string', default: '5' },
    window: { type: 'string', default: '3600000' },
    planned: { type: 'boolean', default: false },
  },
});

const cfg = {
  emails: Number(args.emails),
  senders: Number(args.senders),
  campaigns: Number(args.campaigns),
  senderLimit: Number(args['sender-limit']),
  campaignLimit: Number(args['campaign-limit']),
  intervalMs: Number(args.interval),
  workers: Number(args.workers),
  windowMs: Number(args.window),
  planned: args.planned,
};

type SimJob = {
  seq: number; // arrival order
  campaign: number;
  sender: number;
  dueAt: number;
  reservedFor: number | null; // slot already reserved: send without asking again
  deferredTo: { window: number } | null;
};

type Sent = { seq: number; campaign: number; sender: number; at: number };

const runId = Date.now().toString(36);
const senderKey = (sender: number) => `load-${runId}-${sender}`;

async function main() {
  const t0 = (Math.floor(Date.now() / cfg.windowMs) + 24) * cfg.windowMs; // a clean window start
  const fmt = (ms: number) => `+${((ms - t0) / 60_000).toFixed(1)} min`;

  // Each campaign's emails in arrival order. With --planned, due times come from
  // the same planner the API uses; otherwise everything is due at t0.
  const perCampaign = Array.from({ length: cfg.campaigns }, (_, c) =>
    Array.from({ length: cfg.emails }, (_, seq) => seq).filter((seq) => seq % cfg.campaigns === c),
  );
  const queue: SimJob[] = perCampaign.flatMap((seqs, campaign) => {
    const times = cfg.planned
      ? planSchedule({
          count: seqs.length,
          startAt: t0,
          delayMs: cfg.intervalMs,
          hourlyLimit: Math.min(cfg.campaignLimit, cfg.senderLimit),
          windowMs: cfg.windowMs,
        }).times
      : seqs.map(() => t0);
    return seqs.map((seq, i) => ({
      seq,
      campaign,
      sender: campaign % cfg.senders,
      dueAt: times[i]!,
      reservedFor: null,
      deferredTo: null,
    }));
  });
  const sent: Sent[] = [];
  let limiterCalls = 0;
  let deferrals = 0;
  let limitReachedEvents = 0;

  console.log(
    `Load test: ${cfg.emails} emails ${cfg.planned ? 'planned per campaign' : 'due at the same moment'}, ${cfg.campaigns} campaign(s), ` +
      `${cfg.senders} sender(s), ${cfg.workers} parallel workers\n` +
      `Limits: ${cfg.senderLimit}/window per sender, ${cfg.campaignLimit}/window per campaign, ` +
      `${cfg.intervalMs} ms between sends, window ${cfg.windowMs / 60_000} min\n`,
  );

  const started = Date.now();
  while (queue.length > 0) {
    // Workers take the earliest due jobs first (arrival order breaks ties).
    queue.sort((a, b) => a.dueAt - b.dueAt || a.seq - b.seq);
    const now = queue[0]!.dueAt;
    const batch: SimJob[] = [];
    while (batch.length < cfg.workers && queue.length > 0 && queue[0]!.dueAt <= now) {
      batch.push(queue.shift()!);
    }

    await Promise.all(
      batch.map(async (job) => {
        if (job.reservedFor !== null) {
          sent.push({ seq: job.seq, campaign: job.campaign, sender: job.sender, at: now });
          return;
        }
        limiterCalls++;
        const r = await reserveSendSlot({
          now,
          senderId: senderKey(job.sender),
          campaignId: job.campaign,
          senderLimit: cfg.senderLimit,
          campaignLimit: cfg.campaignLimit,
          minIntervalMs: cfg.intervalMs,
          windowMs: cfg.windowMs,
          deferredFrom: job.deferredTo ?? undefined,
        });
        if (r.kind === 'deferred') {
          deferrals++;
          queue.push({
            ...job,
            dueAt: r.retryAt,
            deferredTo: { window: r.targetWindow },
          });
          return;
        }
        if (r.reachedSenderLimit || r.reachedCampaignLimit) limitReachedEvents++;
        if (r.sendAt > now) {
          queue.push({ ...job, dueAt: r.sendAt, reservedFor: r.sendAt });
        } else {
          sent.push({ seq: job.seq, campaign: job.campaign, sender: job.sender, at: now });
        }
      }),
    );
  }
  const elapsed = Date.now() - started;

  // --- Report -------------------------------------------------------------
  const windowOf = (at: number) => Math.floor((at - t0) / cfg.windowMs);
  const perWindow = new Map<string, number>();
  const perCampaignWindow = new Map<string, number>();
  for (const s of sent) {
    const w = windowOf(s.at);
    perWindow.set(`${w}|${s.sender}`, (perWindow.get(`${w}|${s.sender}`) ?? 0) + 1);
    perCampaignWindow.set(
      `${w}|${s.campaign}`,
      (perCampaignWindow.get(`${w}|${s.campaign}`) ?? 0) + 1,
    );
  }

  const windows = Math.max(...sent.map((s) => windowOf(s.at))) + 1;
  console.log('Emails sent per window:');
  for (let w = 0; w < windows; w++) {
    const cells = Array.from(
      { length: cfg.senders },
      (_, s) => `sender ${s + 1}: ${perWindow.get(`${w}|${s}`) ?? 0}`,
    );
    console.log(`  window ${w + 1} (${fmt(t0 + w * cfg.windowMs)}): ${cells.join(', ')}`);
  }

  const uniqueSent = new Set(sent.map((s) => s.seq)).size;
  const maxSender = Math.max(...perWindow.values());
  const maxCampaign = Math.max(...perCampaignWindow.values());

  let minGap = Infinity;
  for (let s = 0; s < cfg.senders; s++) {
    const times = sent
      .filter((x) => x.sender === s)
      .map((x) => x.at)
      .sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) minGap = Math.min(minGap, times[i]! - times[i - 1]!);
  }

  // Order check: within each campaign, emails should go out in arrival order.
  let inversions = 0;
  let pairs = 0;
  for (let c = 0; c < cfg.campaigns; c++) {
    const inCampaign = sent.filter((x) => x.campaign === c).sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < inCampaign.length; i++) {
      pairs++;
      if (inCampaign[i]!.at < inCampaign[i - 1]!.at) {
        inversions++;
        if (process.env.LOAD_TEST_DEBUG) {
          const [a, b] = [inCampaign[i - 1]!, inCampaign[i]!];
          console.log(
            `  inversion in campaign ${c}: #${a.seq} at ${fmt(a.at)} after #${b.seq} at ${fmt(b.at)}`,
          );
        }
      }
    }
  }

  const check = (ok: boolean) => (ok ? 'PASS' : 'FAIL');
  const lastSend = Math.max(...sent.map((s) => s.at));
  console.log(`
Results (simulated ${((lastSend - t0) / 3_600_000).toFixed(2)} h of sending, computed in ${elapsed} ms):
  ${check(uniqueSent === cfg.emails && sent.length === cfg.emails)}  every email sent exactly once: ${uniqueSent}/${cfg.emails}, none dropped
  ${check(maxSender <= cfg.senderLimit)}  max per sender per window: ${maxSender} (limit ${cfg.senderLimit})
  ${check(maxCampaign <= cfg.campaignLimit)}  max per campaign per window: ${maxCampaign} (limit ${cfg.campaignLimit})
  ${check(minGap >= cfg.intervalMs)}  smallest gap between one sender's sends: ${minGap === Infinity ? 'n/a' : `${minGap} ms`} (minimum ${cfg.intervalMs})
  ${check(inversions === 0)}  order kept within each campaign: ${pairs - inversions}/${pairs} consecutive pairs in order
  info  ${limiterCalls} limiter calls, ${deferrals} emails moved later (to keep limits and order), ${limitReachedEvents} "limit reached" events`);

  // Clean up the keys this run created.
  const keys = await redis.keys(`rl:{s:load-${runId}-*`);
  if (keys.length) await redis.del(...keys);
  await redis.quit();
  if (uniqueSent !== cfg.emails || maxSender > cfg.senderLimit || maxCampaign > cfg.campaignLimit) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error('Load test failed:', err);
  await redis.quit();
  process.exit(1);
});
