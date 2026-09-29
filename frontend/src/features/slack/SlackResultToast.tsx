'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';

const MESSAGES: Record<
  string,
  { tone: 'success' | 'error' | 'info'; title: string; description?: string }
> = {
  connected: {
    tone: 'success',
    title: 'Slack connected',
    description: 'Limit alerts will be posted to the channel you chose.',
  },
  cancelled: { tone: 'info', title: 'Slack connection cancelled' },
  expired: {
    tone: 'error',
    title: 'That Slack link expired',
    description: 'Try Connect Slack again.',
  },
  not_configured: {
    tone: 'error',
    title: "Slack isn't set up on the server",
    description: 'Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to the backend.',
  },
  error: { tone: 'error', title: "Couldn't connect Slack", description: 'Please try again.' },
};

// After Slack sends the browser back (?slack=connected), show the result once.
export function SlackResultToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const result = params.get('slack');
  const shown = useRef<string | null>(null);

  useEffect(() => {
    // Effects can run twice (React dev mode, re-renders): show each result once.
    if (!result || shown.current === result) return;
    shown.current = result;
    const message = MESSAGES[result] ?? MESSAGES.error!;
    toast(message);
    const rest = new URLSearchParams(params);
    rest.delete('slack');
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [result, params, pathname, router, toast]);

  return null;
}
