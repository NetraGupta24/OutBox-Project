import Link from 'next/link';
import { PenSquare } from 'lucide-react';
import type { User } from '@/types/api';
import { SidebarNav } from './SidebarNav';
import { UserMenu } from './UserMenu';

export function Sidebar({ user }: { user: User }) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 border-b border-border px-4 py-5 md:sticky md:top-0 md:h-dvh md:w-56 md:border-r md:border-b-0">
      <Link href="/scheduled" className="px-1 text-2xl font-black tracking-tight text-ink">
        ONB
      </Link>

      <UserMenu user={user} />

      <Link
        href="/compose"
        title="Compose (c)"
        className="flex h-9 items-center justify-center gap-1.5 rounded-full border border-brand-500 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50"
      >
        <PenSquare className="size-3.5" />
        Compose
      </Link>

      <SidebarNav />
    </aside>
  );
}
