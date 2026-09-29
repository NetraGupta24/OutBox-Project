import { GoogleIcon } from '@/components/icons/GoogleIcon';

const ERROR_MESSAGES: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  state: 'That sign-in link expired. Please try again.',
  unverified: "Your Google account's email address isn't verified.",
  not_configured: "Google sign-in isn't set up on the server yet.",
  failed: 'Sign-in failed. Please try again.',
  expired: 'Your session expired. Please sign in again.',
};

type Props = { error?: string; returnTo?: string };

export function LoginCard({ error, returnTo }: Props) {
  const googleHref = `/api/auth/google${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
  const message = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.failed) : null;

  return (
    <div className="w-full max-w-md rounded-xl border border-border bg-surface px-8 py-10 sm:px-10">
      <h1 className="text-center text-3xl font-semibold text-ink">Login</h1>

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
        Login with Google
      </a>

      <div className="my-6 flex items-center gap-3 text-xs text-ink-muted">
        <span className="h-px flex-1 bg-border" />
        or sign up through email
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Shown to match the design; this app only supports Google sign-in. */}
      <form aria-describedby="email-login-note" className="space-y-3">
        <fieldset disabled className="space-y-3">
          <input
            type="email"
            placeholder="Email ID"
            aria-label="Email ID"
            className="h-11 w-full cursor-not-allowed rounded-md bg-muted px-4 text-sm placeholder:text-ink-muted"
          />
          <input
            type="password"
            placeholder="Password"
            aria-label="Password"
            className="h-11 w-full cursor-not-allowed rounded-md bg-muted px-4 text-sm placeholder:text-ink-muted"
          />
          <button
            type="submit"
            className="mt-3 h-11 w-full cursor-not-allowed rounded-md bg-brand-500 text-sm font-medium text-white opacity-60"
          >
            Login
          </button>
        </fieldset>
        <p id="email-login-note" className="text-center text-xs text-ink-muted">
          Email sign-in isn&apos;t available. Use Google above.
        </p>
      </form>
    </div>
  );
}
