'use client';

import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { GoogleIcon } from '@/components/icons/GoogleIcon';
import { Spinner } from '@/components/ui/Spinner';
import type { ApiErrorBody } from '@/types/api';

const ERROR_MESSAGES: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  state: 'That sign-in link expired. Please try again.',
  unverified: "Your Google account's email address isn't verified.",
  not_configured: "Google sign-in isn't set up on the server yet.",
  failed: 'Sign-in failed. Please try again.',
  expired: 'Your session expired. Please sign in again.',
};

const MIN_PASSWORD = 8;

type Mode = 'login' | 'signup';
type Props = { error?: string; returnTo?: string };

const inputClass =
  'h-11 w-full rounded-md bg-muted px-4 text-sm text-ink outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-brand-500/40';

// The server's message; for invalid fields, the first field's message.
function errorFrom(body: ApiErrorBody | null, status: number): string {
  const details = body?.details as { message?: string }[] | undefined;
  if (status === 400 && details?.[0]?.message) return details[0].message;
  return body?.error ?? 'Something went wrong. Please try again.';
}

export function LoginCard({ error, returnTo }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const googleHref = `/api/auth/google${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
  const message = formError ?? (error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.failed) : null);
  const signup = mode === 'signup';

  function switchMode(next: Mode) {
    setMode(next);
    setFormError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (signup && password.length < MIN_PASSWORD) {
      setFormError(`Use at least ${MIN_PASSWORD} characters for your password.`);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      // Plain fetch: a 401 here means a wrong password, not an expired session.
      const res = await fetch(signup ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signup ? { name, email, password } : { email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        setFormError(errorFrom(body, res.status));
        setBusy(false);
        return;
      }
      // A full page load, so server-rendered pages see the new session.
      window.location.assign(returnTo ?? '/scheduled');
    } catch {
      setFormError("Can't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-border bg-surface px-8 py-10 sm:px-10">
      <h1 className="text-center text-3xl font-semibold text-ink">
        {signup ? 'Create account' : 'Login'}
      </h1>

      {message && (
        <p
          role="alert"
          className="mt-6 rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700"
        >
          {message}
        </p>
      )}

      <a
        href={googleHref}
        className="mt-8 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-brand-50 text-sm font-medium text-ink transition-colors hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <GoogleIcon className="size-4" />
        {signup ? 'Sign up with Google' : 'Login with Google'}
      </a>

      <div className="my-6 flex items-center gap-3 text-xs text-ink-muted">
        <span className="h-px flex-1 bg-border" />
        or sign up through email
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={submit} className="space-y-3">
        {signup && (
          <input
            type="text"
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            placeholder="Full name"
            aria-label="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        )}
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="Email ID"
          aria-label="Email ID"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete={signup ? 'new-password' : 'current-password'}
            required
            maxLength={128}
            placeholder={signup ? `Password (at least ${MIN_PASSWORD} characters)` : 'Password'}
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            title={showPassword ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-muted hover:text-ink"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-brand-500 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60"
        >
          {busy && <Spinner className="size-3.5" />}
          {signup ? 'Create account' : 'Login'}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-ink-muted">
        {signup ? 'Already have an account? ' : "Don't have an account? "}
        <button
          type="button"
          onClick={() => switchMode(signup ? 'login' : 'signup')}
          className="font-medium text-brand-600 hover:underline"
        >
          {signup ? 'Login' : 'Create one'}
        </button>
      </p>
    </div>
  );
}
