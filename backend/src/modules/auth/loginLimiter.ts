/**
 * Slows down password guessing: after too many failed sign-ins for one email,
 * or from one IP address, further attempts are refused for a while. Counters
 * live in Redis, so the limit holds across API instances.
 *
 * If Redis is unavailable, sign-in keeps working without the limit rather
 * than locking everyone out.
 *
 * The IP is req.ip, from X-Forwarded-For (see TRUST_PROXY). In production the
 * HTTPS proxy (Caddy) sets that header to the real client address, replacing
 * anything the client sent, so it can't be spoofed to dodge the IP limit.
 */
import { redis } from '../../lib/redis.js';
import { withTimeout } from '../../lib/async.js';
import { errorMessage } from '../../lib/errors.js';
import { HttpError } from '../../lib/httpError.js';

const WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES_PER_EMAIL = 10;
const MAX_FAILURES_PER_IP = 50;
const MAX_SIGNUPS_PER_IP = 20;
const REDIS_TIMEOUT_MS = 1_000;

const emailKey = (email: string) => `auth:fail:email:${email}`;
const ipKey = (ip: string) => `auth:fail:ip:${ip}`;
const signupKey = (ip: string) => `auth:signup:ip:${ip}`;

function tooMany(): HttpError {
  return new HttpError(429, 'Too many attempts. Please wait 15 minutes and try again.');
}

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await withTimeout(fn(), REDIS_TIMEOUT_MS, 'Redis timeout');
  } catch (err) {
    console.warn(`Sign-in rate limit skipped: ${errorMessage(err)}`);
    return fallback;
  }
}

async function bump(key: string): Promise<number> {
  const [[, count]] = (await redis.multi().incr(key).expire(key, WINDOW_SECONDS, 'NX').exec()) as [
    [unknown, number],
    unknown,
  ];
  return count;
}

export async function assertLoginAllowed(email: string, ip: string): Promise<void> {
  const [byEmail = 0, byIp = 0] = await safely(
    async () => (await redis.mget(emailKey(email), ipKey(ip))).map(Number),
    [0, 0],
  );
  if (byEmail >= MAX_FAILURES_PER_EMAIL || byIp >= MAX_FAILURES_PER_IP) throw tooMany();
}

export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  await safely(() => Promise.all([bump(emailKey(email)), bump(ipKey(ip))]), null);
}

export async function clearLoginFailures(email: string): Promise<void> {
  await safely(() => redis.del(emailKey(email)), 0);
}

export async function assertSignupAllowed(ip: string): Promise<void> {
  const count = await safely(() => bump(signupKey(ip)), 0);
  if (count > MAX_SIGNUPS_PER_IP) throw tooMany();
}
