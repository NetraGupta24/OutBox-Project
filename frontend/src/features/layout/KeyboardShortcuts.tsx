'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

// "c" opens Compose, "/" focuses the search box.
export function KeyboardShortcuts() {
  const router = useRouter();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === 'c') {
        e.preventDefault();
        router.push('/compose');
      } else if (e.key === '/') {
        const search = document.getElementById('email-search');
        if (search) {
          e.preventDefault();
          search.focus();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);
  return null;
}
