import Link from 'next/link';
import { Clock, Send } from 'lucide-react';
import type { User } from '@/types/api';
import { NavItem } from './NavItem';
import { UserMenu } from './UserMenu';

export function Sidebar({ user }: { user: User }) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 border-b border-border px-4 py-5 md:h-dvh md:w-56 md:border-r md:border-b-0">
      <Link href="/scheduled" className="px-1 text-2xl font-black tracking-tight text-ink">
        ONB
      </Link>

      <UserMenu user={user} />

      <Link
        href="/compose"
        className="flex h-9 items-center justify-center rounded-full border border-brand-500 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50"
      >
        Compose
      </Link>

      <nav aria-label="Mailboxes" className="flex flex-col gap-1">
        <span className="px-2.5 pb-1 text-[10px] font-medium tracking-wider text-ink-muted uppercase">
          Core
        </span>
        <NavItem href="/scheduled" icon={<Clock className="size-4" />} label="Scheduled" />
        <NavItem href="/sent" icon={<Send className="size-4" />} label="Sent" />
      </nav>
    </aside>
  );
}
