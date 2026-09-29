'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

type Props = {
  href: string;
  icon: ReactNode;
  label: string;
  count?: number;
  hint?: string; // extra detail shown on hover
  alert?: string; // shows a red dot, e.g. "3 failed"
};

export function NavItem({ href, icon, label, count, hint, alert }: Props) {
  const active = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      title={[alert, hint].filter(Boolean).join(' · ') || undefined}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors md:flex-none ${
        active ? 'bg-brand-50 font-medium text-ink' : 'text-ink/80 hover:bg-muted'
      }`}
    >
      <span className="text-ink-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {alert && <span className="size-1.5 rounded-full bg-red-500" aria-label={alert} />}
      {count !== undefined && (
        <span className="text-[11px] tabular-nums text-ink-muted">{count.toLocaleString()}</span>
      )}
    </Link>
  );
}
