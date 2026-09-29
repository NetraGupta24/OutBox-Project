const DEFAULT_PATH = '/scheduled';

// Only same-site paths, so ?returnTo= can't send people to another website.
export function safeReturnPath(value: string | undefined | null): string {
  if (!value || value.length > 200) return DEFAULT_PATH;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\'))
    return DEFAULT_PATH;
  if (value.startsWith('/login')) return DEFAULT_PATH;
  return value;
}
