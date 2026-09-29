import { ServerUnavailable } from '@/components/ServerUnavailable';
import { requireUser } from '@/lib/server/auth';

// Full-page screens (Compose, email detail), as in the Figma. Needs a valid session.
export default async function FocusLayout({ children }: LayoutProps<'/'>) {
  const user = await requireUser();
  if (user === 'unavailable') return <ServerUnavailable />;
  return <div className="flex min-h-dvh flex-col">{children}</div>;
}
