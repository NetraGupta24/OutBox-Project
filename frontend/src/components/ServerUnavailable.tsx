export function ServerUnavailable() {
  return (
    <main className="flex flex-1 items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-lg font-semibold">Can&apos;t reach the server</h1>
        <p className="mt-1 text-sm text-ink-muted">Check that the API is running, then reload.</p>
      </div>
    </main>
  );
}
