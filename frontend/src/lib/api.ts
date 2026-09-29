import type { ApiErrorBody } from '@/types/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Calls the backend through the same-origin /api proxy. Throws ApiError with
 * the server's message on failure. A 401 means the session ended: the browser
 * goes to the login page and returns here afterwards.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 401) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    // A full page load, so no stale data survives the sign-out.
    window.location.assign(
      new URL(`/login?error=expired&returnTo=${returnTo}`, window.location.origin),
    );
    throw new ApiError(401, 'Your session expired.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body?.details);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
