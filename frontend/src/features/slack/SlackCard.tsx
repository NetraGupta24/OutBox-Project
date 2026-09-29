'use client';

import { useState } from 'react';
import { BellRing, CheckCircle2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useApi } from '@/hooks/useApi';
import { api, ApiError } from '@/lib/api';
import type { SlackStatus } from '@/types/api';

const CONNECT_URL = '/api/integrations/slack/connect';

// Sidebar card for Slack alerts: connect, test, disconnect.
export function SlackCard() {
  const toast = useToast();
  const { data: slack, loading, reload } = useApi<SlackStatus>('/api/integrations/slack');
  const [busy, setBusy] = useState<'test' | 'disconnect' | null>(null);

  async function sendTest() {
    setBusy('test');
    try {
      const { channel } = await api<{ channel: string | null }>('/api/integrations/slack/test', {
        method: 'POST',
      });
      toast({
        tone: 'success',
        title: 'Test message sent',
        description: `Check ${channel ?? 'your Slack channel'}.`,
      });
    } catch (err) {
      toast({
        tone: 'error',
        title: "Couldn't send to Slack",
        description: (err as ApiError).message,
      });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm('Stop sending limit alerts to Slack?')) return;
    setBusy('disconnect');
    try {
      await api('/api/integrations/slack', { method: 'DELETE' });
      toast({ tone: 'info', title: 'Slack disconnected' });
      await reload();
    } catch (err) {
      toast({
        tone: 'error',
        title: "Couldn't disconnect",
        description: (err as ApiError).message,
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !slack) return <Skeleton className="h-24 w-full rounded-lg" />;
  if (!slack) return null;

  return (
    <section aria-label="Slack alerts" className="rounded-lg border border-border p-3 text-[12px]">
      {slack.connected ? (
        <>
          <p className="flex items-center gap-1.5 font-medium text-ink">
            <CheckCircle2 className="size-3.5 text-brand-600" /> Slack alerts on
          </p>
          <p
            className="mt-0.5 truncate text-ink-muted"
            title={`${slack.channel} · ${slack.teamName}`}
          >
            {slack.channel} · {slack.teamName}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              pill
              loading={busy === 'test'}
              onClick={sendTest}
              className="h-7 px-2.5 text-xs"
            >
              Send test
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'disconnect'}
              onClick={disconnect}
              className="h-7 px-1.5 text-xs text-ink-muted"
            >
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="flex items-center gap-1.5 font-medium text-ink">
            {slack.disconnectedBySlack ? (
              <TriangleAlert className="size-3.5 text-amber-600" />
            ) : (
              <BellRing className="size-3.5 text-ink-muted" />
            )}
            Slack alerts
          </p>
          <p className="mt-0.5 text-ink-muted">
            {!slack.configured
              ? 'Not set up on the server yet.'
              : slack.disconnectedBySlack
                ? 'Slack stopped accepting messages. Connect again.'
                : 'Get a message when a sender hits its hourly limit.'}
          </p>
          {slack.configured && (
            <a
              href={CONNECT_URL}
              className="mt-2 inline-flex h-7 items-center rounded-full bg-ink px-3 text-xs font-medium text-white hover:bg-ink/85"
            >
              {slack.disconnectedBySlack ? 'Reconnect Slack' : 'Connect Slack'}
            </a>
          )}
        </>
      )}
    </section>
  );
}
