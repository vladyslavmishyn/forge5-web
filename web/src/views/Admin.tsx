import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errMsg, type AdminRequest } from '../api';
import { Msg } from '../components/Msg';
import { useFlash } from '../useFlash';

interface Props {
  isAdmin: boolean;
  onAuthChange: () => Promise<void>;
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export function Admin({ isAdmin, onAuthChange }: Props) {
  const [msg, flash] = useFlash();
  const [password, setPassword] = useState('');
  const [pwErr, setPwErr] = useState(false);
  const [requests, setRequests] = useState<AdminRequest[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRequests(await api<AdminRequest[]>('/admin/requests'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await onAuthChange();
      else flash(errMsg(e), true);
    }
  }, [flash, onAuthChange]);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15000);
    return () => window.clearInterval(t);
  }, [isAdmin, load]);

  async function login() {
    if (busy) return;
    if (!password) {
      setPwErr(true);
      flash('Enter the admin password.', true);
      return;
    }
    setBusy(true);
    try {
      await api('/admin/login', 'POST', { password });
      setPassword('');
      setPwErr(false);
      await onAuthChange();
    } catch (e) {
      setPwErr(true);
      flash(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api('/admin/logout', 'POST', {});
    } catch (e) {
      flash(errMsg(e), true);
    }
    setRequests(null);
    await onAuthChange();
  }

  async function markReturned(id: number) {
    try {
      await api(`/admin/requests/${id}/return`, 'POST', {});
      flash(`Request #${id} marked returned.`);
    } catch (e) {
      flash(errMsg(e), true);
    }
    await load();
  }

  if (!isAdmin) {
    return (
      <section className="view on" id="v-admin">
        <div className="sec-h">
          <h2>Admin</h2>
          <p>Organizers only. Sign in to run the phases and the equipment desk.</p>
        </div>
        <Msg state={msg} />
        <div className="card" style={{ maxWidth: '460px' }}>
          <div className="field">
            <label className="lb" htmlFor="a-pw">Admin password</label>
            <input type="password" id="a-pw" autoComplete="current-password" maxLength={200}
              className={pwErr ? 'err' : undefined} value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void login(); }} />
          </div>
          <button type="button" className="btn p" onClick={login}>Sign in</button>
        </div>
      </section>
    );
  }

  const active = (requests ?? []).filter((r) => !r.returnedAt);
  const returned = (requests ?? []).filter((r) => r.returnedAt);
  const byTeam = new Map<number, AdminRequest[]>();
  for (const r of active) byTeam.set(r.projectId, [...(byTeam.get(r.projectId) ?? []), r]);

  return (
    <section className="view on" id="v-admin">
      <div className="sec-h">
        <h2>Equipment desk</h2>
        <p>One pick-list per team. Print them for the desk, then mark each request returned at the closing.</p>
      </div>
      <Msg state={msg} />
      <div className="filters no-print">
        <span className="lb2">Admin</span>
        <button type="button" className="btn sm" onClick={() => window.print()}>Print pick lists</button>
        <button type="button" className="btn w sm" onClick={() => { window.location.href = '/api/admin/registrations.csv'; }}>
          Download registrations CSV
        </button>
        <div style={{ flex: 1 }}></div>
        <button type="button" className="btn r sm" onClick={logout}>Admin sign-out</button>
      </div>

      {requests === null ? (
        <div className="card"><b>Loading…</b></div>
      ) : byTeam.size === 0 ? (
        <div className="card"><b>No open equipment requests.</b></div>
      ) : (
        [...byTeam.values()].map((reqs) => {
          const first = reqs[0]!;
          const totals = new Map<string, { name: string; qty: number }>();
          for (const r of reqs)
            for (const it of r.items) {
              const t = totals.get(it.key);
              totals.set(it.key, { name: it.name, qty: (t?.qty ?? 0) + it.qty });
            }
          return (
            <div className="card pick" key={first.projectId} style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <div>
                  <span className="id mono" style={{ fontSize: '11.5px', fontWeight: 700 }}>{first.projectCode}</span>
                  <h3 style={{ fontSize: '19px', lineHeight: 1.12, marginTop: '4px' }}>{first.projectTitle}</h3>
                </div>
                <span className="tag" style={{ background: 'var(--lime)' }}>
                  {[...totals.values()].reduce((s, t) => s + t.qty, 0)} items out
                </span>
              </div>
              {reqs.map((r) => (
                <div key={r.id} style={{ borderTop: '3px dashed var(--ink)', paddingTop: '10px', marginTop: '10px' }}>
                  <div className="rh" style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: '#5C5470', marginBottom: '7px', display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    <span>Request #{r.id} · {r.requestedBy ?? 'former member'}</span>
                    <span>{fmtTime(r.createdAt)}</span>
                  </div>
                  {r.items.map((it) => (
                    <div className="mem" key={it.key}>
                      <span className="mono" style={{ minWidth: '38px', fontWeight: 700 }}>{it.qty} ×</span>
                      <span>{it.name}</span>
                    </div>
                  ))}
                  <div className="no-print" style={{ marginTop: '9px' }}>
                    <button type="button" className="btn sm" onClick={() => markReturned(r.id)}>Mark returned</button>
                  </div>
                </div>
              ))}
            </div>
          );
        })
      )}

      {returned.length > 0 && (
        <div className="no-print">
          <div className="sec-h" style={{ marginTop: '30px' }}><h2 style={{ fontSize: '21px' }}>Returned</h2></div>
          {returned.map((r) => (
            <div className="rrow" key={r.id}>
              <div className="rn" style={{ width: 'auto', fontSize: '13px' }}>#{r.id}</div>
              <div className="rt">
                <b>{r.projectCode} · {r.projectTitle}</b>
                <small>
                  {r.items.map((it) => `${it.qty} × ${it.name}`).join(' · ')} — returned {fmtTime(r.returnedAt!)}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
