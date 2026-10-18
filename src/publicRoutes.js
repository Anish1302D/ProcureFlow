// Pages anyone can open from an email link, signed in or not:
//   #/accept-invite/<token>    accept an invitation and set a password
//   #/reset-password/<token>   choose a new password
//   #/confirm-email/<token>    confirm a new email address
//   #/forgot-password          ask for a reset link
// The token sits after "#", so the browser never sends it to any server.

const LINK_PAGES = ['accept-invite', 'reset-password', 'confirm-email'];
const TOKEN = /^[0-9a-f]{64}$/i;

export function readPublicRoute() {
  if (typeof window === 'undefined') return null;
  const [page, token] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (LINK_PAGES.includes(page) && TOKEN.test(token ?? '')) return { page, token };
  if (page === 'forgot-password') return { page };

  // Setup links handed out before invitations were emailed: /setup-account?token=…
  const legacy = new URLSearchParams(window.location.search).get('token');
  if (legacy && TOKEN.test(legacy)) return { page: 'accept-invite', token: legacy };
  return null;
}

/** Take the token out of the address bar and history once it has been read. */
export function forgetLinkInAddressBar() {
  if (typeof window !== 'undefined' && window.history?.replaceState) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}
