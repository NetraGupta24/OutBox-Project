import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 disabled:bg-brand-500/50',
  outline:
    'border border-brand-500 text-brand-600 hover:bg-brand-50 disabled:border-border disabled:text-ink-muted',
  ghost: 'text-ink hover:bg-muted disabled:text-ink-muted',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-sm',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  pill?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  pill = false,
  className = '',
  children,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed ${
        pill ? 'rounded-full' : 'rounded-md'
      } ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {loading ? <Spinner className="size-3.5" /> : icon}
      {children}
    </button>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string; // accessible name and tooltip
  active?: boolean;
};

export function IconButton({
  label,
  active = false,
  className = '',
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-muted text-ink' : ''
      } ${className}`}
    >
      {children}
    </button>
  );
}
