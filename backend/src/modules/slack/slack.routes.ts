import { Router } from 'express';
import { env } from '../../config/env.js';
import { errorMessage } from '../../lib/errors.js';
import { HttpError } from '../../lib/httpError.js';
import { currentUser } from '../auth/requireAuth.js';
import {
  connectSlack,
  createSlackAuthUrl,
  disconnectSlack,
  notifyUser,
  readSlackState,
  slackConfigured,
  slackStatus,
  testMessage,
} from './slack.service.js';

// Where the browser lands after connecting; the dashboard shows a message for ?slack=…
const back = (result: string) => `${env.FRONTEND_URL}/scheduled?slack=${result}`;

export const slackRouter = Router();

slackRouter.get('/', async (req, res) => {
  res.json(await slackStatus(currentUser(req).id));
});

// Step 1: send the browser to Slack to pick a workspace and channel.
slackRouter.get('/connect', async (req, res) => {
  if (!slackConfigured()) return res.redirect(back('not_configured'));
  res.redirect(await createSlackAuthUrl(currentUser(req).id));
});

// Step 2: Slack sends the browser back with a one-time code.
slackRouter.get('/callback', async (req, res) => {
  const user = currentUser(req);
  const { code, state, error } = req.query;
  if (error) return res.redirect(back(error === 'access_denied' ? 'cancelled' : 'error'));
  const stateUser = typeof state === 'string' ? await readSlackState(state) : null;
  if (stateUser !== user.id || typeof code !== 'string') return res.redirect(back('expired'));

  try {
    await connectSlack(user.id, code);
    res.redirect(back('connected'));
  } catch (err) {
    console.error('Slack connect failed:', errorMessage(err));
    res.redirect(back('error'));
  }
});

// Sends a real message now, so the connection can be checked (e.g. in a demo).
slackRouter.post('/test', async (req, res) => {
  const user = currentUser(req);
  const status = await slackStatus(user.id);
  if (!status.connected) throw new HttpError(409, 'Slack is not connected');
  let result;
  try {
    result = await notifyUser(user.id, testMessage(status.channel));
  } catch (err) {
    throw new HttpError(502, `Slack didn't accept the message: ${errorMessage(err)}`);
  }
  if (result === 'revoked') {
    throw new HttpError(410, 'Slack no longer accepts messages for this channel. Connect again.');
  }
  res.json({ sent: true, channel: status.channel });
});

slackRouter.delete('/', async (req, res) => {
  await disconnectSlack(currentUser(req).id);
  res.status(204).end();
});
