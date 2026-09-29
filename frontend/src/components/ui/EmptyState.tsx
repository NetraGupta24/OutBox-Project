import type { ReactNode } from 'react';

type Props = { icon: ReactNode; title: string; description?: string; action?: ReactNode };

export function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        {icon}
      </span>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
