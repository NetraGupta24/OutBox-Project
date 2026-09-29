// Phase 1 placeholder: confirms the frontend can reach the backend through
// the /api rewrite. Replaced by the login page and dashboard in phases 6-7.
type Health = {
  status: 'ok' | 'degraded';
  services: Record<string, 'up' | 'down'>;
};

async function getHealth(): Promise<Health | null> {
  const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${backendUrl}/health`, { cache: 'no-store' });
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

export default async function Home() {
  const health = await getHealth();

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-border p-8">
        <h1 className="text-2xl font-semibold">ReachInbox Scheduler</h1>
        <p className="mt-1 text-sm text-ink-muted">Backend status</p>
        {health ? (
          <ul className="mt-4 space-y-2 text-sm">
            {Object.entries(health.services).map(([name, state]) => (
              <li key={name} className="flex justify-between rounded-md bg-muted px-3 py-2">
                <span className="capitalize">{name}</span>
                <span className={state === 'up' ? 'text-brand-600' : 'text-red-600'}>{state}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-red-600">Backend is not reachable.</p>
        )}
      </div>
    </main>
  );
}
