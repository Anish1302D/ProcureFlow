import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';

/**
 * Loads `path` and re-loads it whenever anything on screen changes data
 * (the app-wide `refresh()`), or when `reload()` is called. Pass a null path
 * to skip. The previous result stays visible while a reload is in flight, so
 * lists don't flash empty after every action.
 */
export function useApi(path) {
  const { dataVersion } = useApp();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: !s.data, error: null }));
    api(path, { signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setState((s) => ({ data: s.data, error: s.data ? null : error, loading: false }));
        }
      });
    return () => controller.abort();
  }, [path, dataVersion, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/**
 * Runs a change, reports it, and refreshes the screen. Resolves to
 * { ok: true, result } or { ok: false, error } — a successful call can
 * legitimately return nothing (204), so the result alone can't signal failure.
 */
export function useAction() {
  const { showToast, refresh } = useApp();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (fn, successMessage) => {
    setBusy(true);
    try {
      const result = await fn();
      if (successMessage) showToast(successMessage, 'success');
      refresh();
      return { ok: true, result };
    } catch (error) {
      showToast(error.message, 'error');
      return { ok: false, error };
    } finally {
      setBusy(false);
    }
  }, [showToast, refresh]);

  return { run, busy };
}
