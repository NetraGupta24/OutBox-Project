'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';

type Options = {
  // Refresh in the background every N ms while the tab is visible.
  refreshMs?: number;
};

type State<T> = {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean; // first load for this path: show skeletons
  refreshing: boolean; // background refresh: keep showing data
  updatedAt: number | undefined;
};

/** GET `path` (null = don't fetch). Stale responses are ignored. */
export function useApi<T>(path: string | null, { refreshMs }: Options = {}) {
  const [state, setState] = useState<State<T>>({
    data: undefined,
    error: undefined,
    loading: path !== null,
    refreshing: false,
    updatedAt: undefined,
  });
  const requestId = useRef(0);

  const load = useCallback(
    async (background: boolean) => {
      if (!path) return;
      const id = ++requestId.current;
      setState((s) => ({ ...s, loading: !background, refreshing: background }));
      try {
        const data = await api<T>(path);
        if (id === requestId.current) {
          setState({
            data,
            error: undefined,
            loading: false,
            refreshing: false,
            updatedAt: Date.now(),
          });
        }
      } catch (err) {
        if (id === requestId.current) {
          setState((s) => ({ ...s, error: err as ApiError, loading: false, refreshing: false }));
        }
      }
    },
    [path],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!refreshMs || !path) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, refreshMs);
    const onVisible = () => document.visibilityState === 'visible' && void load(true);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, refreshMs, path]);

  const reload = useCallback(() => load(true), [load]);
  return { ...state, reload };
}
