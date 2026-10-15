import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, hasToken, onSessionExpired, setToken } from '../api/client';

const AppContext = createContext(null);

// Which set of screens a person gets, decided from their real roles and the
// workflow stages they staff — never chosen by the user.
export function portalFor(user) {
  if (!user) return null;
  if (user.roles.includes('ADMIN')) return 'admin';
  if (user.roles.includes('PRINCIPAL')) return 'principal';
  if (user.stages.length > 0) return 'approver'; // Purchase Committee, CDC, Chairman, VP
  return 'faculty';
}

export const HOME = {
  admin: 'admin-dashboard',
  principal: 'dashboard',
  approver: 'approver-dashboard',
  faculty: 'faculty-dashboard',
};

// Navigation lives in the URL hash: #/requests-all, #/review-queue/request/<id>.
// Hash routes survive a refresh, can be bookmarked or linked from an email,
// and need no rewrite rules on the web server (IIS serves index.html as is).
// #/requests/<id> is the short form used in notification emails.
function parseHash() {
  const [page, kind, id] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (page === 'requests' && kind) return { page: null, open: { kind: 'request', id: kind } };
  if (page === 'issues' && kind) return { page: null, open: { kind: 'issue', id: kind } };
  return { page: page || null, open: kind && id ? { kind, id } : null };
}

function writeHash(page, open) {
  const hash = `#/${page}${open ? `/${open.kind}/${open.id}` : ''}`;
  if (window.location.hash !== hash) window.history.pushState(null, '', hash);
}

export const AppProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(hasToken());
  const [route, setRoute] = useState(parseHash);
  const [toast, setToast] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [modals, setModals] = useState({ newRequest: false, newIssue: false, inventory: false, export: false, bill: false, loginNotifications: false });
  const toastTimer = useRef();

  const portal = portalFor(user);
  const activePage = route.page ?? (portal ? HOME[portal] : 'login');

  const showToast = useCallback((message, type = 'success') => {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  /** Re-fetch everything on screen after a change. */
  const refresh = useCallback(() => setDataVersion((v) => v + 1), []);

  const signOut = useCallback((message) => {
    setToken(null);
    setUser(null);
    setRoute({ page: null, open: null });
    window.history.pushState(null, '', window.location.pathname);
    if (message) showToast(message, 'info');
  }, [showToast]);

  useEffect(() => {
    onSessionExpired(() => signOut('Your session has ended. Please sign in again.'));
  }, [signOut]);

  // Restore a session from a stored token on load.
  useEffect(() => {
    if (!hasToken()) return;
    api('/api/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parseHash());
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  // Automatic real-time background sync: ensures incoming requests, status changes,
  // and notification updates appear immediately without requiring manual page refresh.
  useEffect(() => {
    if (!user) return undefined;

    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    // Periodic heartbeat sync every 6 seconds while the page is visible
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    }, 6000);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(timer);
    };
  }, [user, refresh]);

  const signIn = useCallback(async (email, password) => {
    const { token, user: me } = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    setToken(token);
    setUser(me);
    // Keep a deep link the person arrived with (e.g. from an email).
    setRoute(parseHash());
    showToast(`Signed in as ${me.name}`, 'success');
    // Show notification popup after login.
    setModals((m) => ({ ...m, loginNotifications: true }));
  }, [showToast]);

  const signInWithSession = useCallback((token, me) => {
    setToken(token);
    setUser(me);
    setRoute(parseHash());
    showToast(`Welcome, ${me.name}`, 'success');
  }, [showToast]);

  const setActivePage = useCallback((page) => {
    setRoute({ page, open: null });
    writeHash(page, null);
  }, []);

  const openRecord = useCallback((kind, id) => {
    setRoute((r) => {
      const page = r.page ?? HOME[portalFor(user)] ?? 'login';
      writeHash(page, { kind, id });
      return { page, open: { kind, id } };
    });
  }, [user]);

  const closeRecord = useCallback(() => {
    setRoute((r) => {
      const page = r.page ?? HOME[portalFor(user)] ?? 'login';
      writeHash(page, null);
      return { page, open: null };
    });
  }, [user]);

  const openModal = useCallback((name) => setModals((m) => ({ ...m, [name]: true })), []);
  const closeModal = useCallback((name) => setModals((m) => ({ ...m, [name]: false })), []);

  const value = useMemo(() => ({
    user, portal, booting, signIn, signInWithSession, signOut,
    activePage, setActivePage,
    openRecord, closeRecord, openRecordState: route.open,
    toast, showToast,
    dataVersion, refresh,
    modals, openModal, closeModal,
  }), [user, portal, booting, signIn, signInWithSession, signOut, activePage, setActivePage, openRecord, closeRecord,
    route.open, toast, showToast, dataVersion, refresh, modals, openModal, closeModal]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => useContext(AppContext);
