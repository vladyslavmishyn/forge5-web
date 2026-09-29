import { useCallback, useEffect, useRef, useState } from 'react';
import type { Phase } from '../../shared/constants';
import { api, errMsg, type AppState, type Me } from './api';
import { Footer, Header, Nav, Ticker } from './components/Chrome';
import { Msg } from './components/Msg';
import { PATHS, viewFromPath, type View } from './routes';
import { useFlash } from './useFlash';
import { Admin } from './views/Admin';
import { Dashboard } from './views/Dashboard';
import { Equipment, type Cart } from './views/Equipment';
import { Projects } from './views/Projects';
import { Register } from './views/Register';
import { Results } from './views/Results';
import { SignIn } from './views/SignIn';
import { Vote } from './views/Vote';

const NO_ME: Me = { user: null, isAdmin: false, verificationRequired: false };
const POLL_MS = 15000;

function initialView(): View {
  const v = viewFromPath(window.location.pathname);
  if (!v) {
    history.replaceState(null, '', '/');
    return 'home';
  }
  return v;
}

export function App() {
  const [view, setViewState] = useState<View>(initialView);
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [me, setMe] = useState<Me>(NO_ME);
  const [cart, setCart] = useState<Cart>({});
  const [selection, setSelection] = useState<number[]>([]);
  const [msg, flash] = useFlash();

  // ------------------------------------------------------------- routing
  const navigate = useCallback((v: View, replace = false) => {
    const path = PATHS[v];
    if (window.location.pathname !== path) {
      if (replace) history.replaceState(null, '', path);
      else history.pushState(null, '', path);
    }
    setViewState(v);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onPop = () => setViewState(viewFromPath(window.location.pathname) ?? 'home');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ---------------------------------------------------------------- data
  const loadState = useCallback(async () => {
    try {
      setState(await api<AppState>('/state'));
      setLoadError('');
    } catch (e) {
      setLoadError(errMsg(e));
    }
  }, []);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api<Me>('/me'));
    } catch {
      /* keep the previous identity on transient errors */
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadState(), loadMe()]);
  }, [loadState, loadMe]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadState();
    }, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh, loadState]);

  // The equipment cart belongs to a team: clear it whenever the user's team (or identity) changes.
  const teamKey = me.user ? `${me.user.email}:${me.user.projectId ?? ''}` : '';
  const prevTeamKey = useRef(teamKey);
  useEffect(() => {
    if (prevTeamKey.current !== teamKey) {
      prevTeamKey.current = teamKey;
      setCart({});
      setSelection([]);
    }
  }, [teamKey]);

  // ------------------------------------------------------------- actions
  const setPhase = useCallback(
    async (p: Phase) => {
      try {
        await api('/admin/phase', 'PUT', { phase: p });
      } catch (e) {
        flash(errMsg(e), true);
      }
      await refresh();
    },
    [flash, refresh],
  );

  const signOut = useCallback(async () => {
    await api('/auth/logout', 'POST', {});
    setCart({});
    setSelection([]);
    await refresh();
  }, [refresh]);

  const onSignedIn = useCallback(
    (m: Me) => {
      setMe(m);
      void loadState();
      navigate('home', true);
      flash(m.user ? `Signed in as ${m.user.email}.` : 'Signed in.');
    },
    [flash, loadState, navigate],
  );

  const onRegistered = useCallback(
    async (m: Me) => {
      setMe(m);
      await loadState();
    },
    [loadState],
  );

  // --------------------------------------------------------------- render
  const phase: Phase = state?.phase ?? 'reg';

  return (
    <>
      <Header phase={phase} isAdmin={me.isAdmin} onHome={() => navigate('home')} onPhase={setPhase} />
      <Nav view={view} projectCount={state?.projects.length ?? 0} isAdmin={me.isAdmin} onView={(v) => navigate(v)} />
      <Ticker />
      <main>
        <div className="wrap">
          <Msg id="appMsg" state={msg} />
          {view === 'signin' ? (
            <SignIn onSignedIn={onSignedIn} goRegister={() => navigate('reg', true)} />
          ) : view === 'admin' ? (
            <Admin isAdmin={me.isAdmin} onAuthChange={refresh} />
          ) : !state ? (
            <section className="view on">
              <div className="locked">
                <div className="lk">{loadError ? '⚠️' : '⏳'}</div>
                <h3>{loadError ? 'Can’t reach the portal' : 'Loading…'}</h3>
                <p>{loadError || 'One moment.'}</p>
                {loadError && (
                  <button type="button" className="btn p" onClick={() => void refresh()}>Try again</button>
                )}
              </div>
            </section>
          ) : (
            <>
              <Dashboard state={state} on={view === 'home'} />
              <Register
                on={view === 'reg'}
                phase={phase}
                me={me}
                onRegistered={onRegistered}
                onSignOut={signOut}
                goProjects={() => navigate('proj')}
              />
              <Projects
                on={view === 'proj'}
                state={state}
                me={me}
                refresh={refresh}
                goRegister={() => navigate('reg')}
                goEquipment={() => navigate('equip')}
              />
              <Equipment on={view === 'equip'} state={state} me={me} cart={cart} setCart={setCart} refresh={refresh} />
              <Vote
                on={view === 'vote'}
                state={state}
                me={me}
                selection={selection}
                setSelection={setSelection}
                refresh={refresh}
                goRegister={() => navigate('reg')}
                onJumpPhase={setPhase}
              />
              <Results on={view === 'results'} phase={phase} isAdmin={me.isAdmin} onJumpPhase={setPhase} />
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
