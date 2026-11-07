import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Health } from '../api/types';

// ---------- Маршрут в hash: работает как web resource Dynamics 365 и переживает F5 ----------

export type Route =
  | { name: 'list'; params: URLSearchParams }
  | { name: 'card'; id: string; params: URLSearchParams }
  | { name: 'checklist'; params: URLSearchParams }
  | { name: 'appeals'; params: URLSearchParams };

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  if (path.startsWith('/c/')) return { name: 'card', id: decodeURIComponent(path.slice(3)), params };
  if (path === '/checklist') return { name: 'checklist', params };
  if (path === '/appeals') return { name: 'appeals', params };
  return { name: 'list', params };
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path: string) => {
  location.hash = path;
};
export const cardPath = (id: string, q?: Record<string, string | number | undefined>) => {
  const qs = q ? Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&') : '';
  return `/c/${encodeURIComponent(id)}${qs ? '?' + qs : ''}`;
};

// ---------- Загрузка данных ----------

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const load = useCallback(
    (silent = false) => {
      const my = ++seq.current;
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
      return fn().then(
        (data) => my === seq.current && setState({ data, error: null, loading: false }),
        (error: Error) => my === seq.current && setState((s) => ({ data: silent ? s.data : null, error, loading: false })),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { ...state, reload: load, setData: (d: T) => setState({ data: d, error: null, loading: false }) };
}

/** Опрос, пока cond() истинно. */
export function usePoll(cb: () => void, active: boolean, ms = 1000) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

// ---------- Общий контекст приложения ----------

export type Role = 'operator' | 'reviewer';

export interface AppCtx {
  role: Role;
  setRole: (r: Role) => void;
  health: Health | null;
  toast: (msg: string, kind?: 'ok' | 'error') => void;
  bumpAppeals: () => void;
}

export const AppContext = createContext<AppCtx | null>(null);
export function useApp() {
  const v = useContext(AppContext);
  if (!v) throw new Error('AppContext missing');
  return v;
}

export function useLocal<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, nv);
      } catch {
        /* хранилище недоступно */
      }
    },
    [key],
  );
  return [v, set];
}
