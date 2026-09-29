import { useEffect, useRef, useState } from 'react';
import { api, errMsg, type Me } from '../api';

/**
 * /signin#token=… — reads the token from the URL fragment (never sent to the server in the URL),
 * clears the fragment immediately, redeems it with a POST, then routes to the dashboard.
 */
export function SignIn({ onSignedIn, goRegister }: { onSignedIn: (me: Me) => void; goRegister: () => void }) {
  const seen = useRef<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const attempt = () => {
      const m = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
      if (window.location.hash) history.replaceState(history.state, '', window.location.pathname);
      if (!m) {
        // StrictMode re-runs effects in dev: don't report "incomplete" after a token was already taken.
        if (seen.current === null) setError('This sign-in link is incomplete. Request a new one from the Register page.');
        return;
      }
      const token = m[1]!;
      if (seen.current === token) return;
      seen.current = token;
      setError('');
      api<Me>('/auth/redeem', 'POST', { token })
        .then(onSignedIn)
        .catch((e) => setError(errMsg(e)));
    };
    attempt();
    window.addEventListener('hashchange', attempt);
    return () => window.removeEventListener('hashchange', attempt);
  }, [onSignedIn]);

  return (
    <section className="view on" id="v-signin">
      <div className="sec-h">
        <h2>Sign in</h2>
      </div>
      <div className="locked">
        <div className="lk">{error ? '⚠️' : '🔑'}</div>
        <h3>{error ? 'Link not valid' : 'Signing you in…'}</h3>
        <p>{error || 'One moment.'}</p>
        {error && (
          <button type="button" className="btn p" onClick={goRegister}>Get a new link</button>
        )}
      </div>
    </section>
  );
}
