'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

type Tone = 'success' | 'error' | 'info';
type Toast = { id: number; tone: Tone; title: string; description?: string };
type ShowToast = (toast: Omit<Toast, 'id'>) => void;

const ToastContext = createContext<ShowToast | null>(null);

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };
const TONES = { success: 'text-brand-600', error: 'text-red-600', info: 'text-sky-600' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback<ShowToast>(
    (toast) => {
      const id = Date.now() + Math.random();
      // A success supersedes earlier error messages (e.g. validation hints).
      setToasts((t) => [
        ...t.filter((x) => toast.tone !== 'success' || x.tone !== 'error').slice(-3),
        { ...toast, id },
      ]);
      setTimeout(() => dismiss(id), toast.tone === 'error' ? 8000 : 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border bg-surface p-3 shadow-lg sm:w-80"
            >
              <Icon className={`mt-0.5 size-4 shrink-0 ${TONES[t.tone]}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-[13px] text-ink-muted">{t.description}</p>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
                className="rounded p-0.5 text-ink-muted hover:bg-muted hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
