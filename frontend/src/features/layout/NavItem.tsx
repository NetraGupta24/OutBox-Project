'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

type Props = { href: string; icon: ReactNode; label: string; count?: number };

export function NavItem({ href, icon, label, count }: Props) {
  const active = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
        active ? 'bg-brand-50 font-medium text-ink' : 'text-ink/80 hover:bg-muted'
      }`}
    >
      <span className="text-ink-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-[11px] text-ink-muted">{count}</span>}
    </Link>
  );
}
