// Some driver errors have an empty message: fall back to the error's name and code.
export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, 1000);
  const code = (err as { code?: unknown }).code;
  const message = err.message || `${err.name}${code ? ` (${String(code)})` : ''}`;
  return message.slice(0, 1000);
}
