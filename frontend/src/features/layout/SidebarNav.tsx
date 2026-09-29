'use client';

import { Clock, Send } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import type { EmailCounts } from '@/types/api';
import { NavItem } from './NavItem';

export function SidebarNav() {
  const { data } = useApi<EmailCounts>('/api/emails/counts', { refreshMs: 5000 });
  return (
    <nav aria-label="Mailboxes" className="flex gap-1 md:flex-col">
      <span className="hidden px-2.5 pb-1 text-[10px] font-medium tracking-wider text-ink-muted uppercase md:block">
        Core
      </span>
      <NavItem
        href="/scheduled"
        icon={<Clock className="size-4" />}
        label="Scheduled"
        count={data?.scheduled}
        hint={data?.delayed ? `${data.delayed} delayed by the hourly limit` : undefined}
      />
      <NavItem
        href="/sent"
        icon={<Send className="size-4" />}
        label="Sent"
        count={data?.sent}
        alert={data?.failed ? `${data.failed} failed` : undefined}
      />
    </nav>
  );
}
