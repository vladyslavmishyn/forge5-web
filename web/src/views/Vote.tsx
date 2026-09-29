import { useState } from 'react';
import { MAX_VOTES, type Phase } from '../../../shared/constants';
import { api, errMsg, type AppState, type Me } from '../api';
import { Msg } from '../components/Msg';
import { useFlash } from '../useFlash';
import { fieldOf } from '../util';

interface Props {
  on: boolean;
  state: AppState;
  me: Me;
  selection: number[];
  setSelection: (fn: (s: number[]) => number[]) => void;
  refresh: () => Promise<void>;
  goRegister: () => void;
  onJumpPhase: (p: Phase) => void;
}

export function Vote({ on, state, me, selection, setSelection, refresh, goRegister, onJumpPhase }: Props) {
  const [msg, flash] = useFlash();
  const [busy, setBusy] = useState(false);
  const user = me.user;
  const voted = !!user?.hasVoted;
  const myTeam = user?.projectId ?? null;
  const existing = new Set(state.projects.map((p) => p.id));
  const picks = voted ? user!.votes : selection.filter((id) => existing.has(id));
  const needsVerify = !!user && me.verificationRequired && !user.emailVerified;

  function toggle(id: number) {
    if (voted) {
      flash('Your ballot is already in.', true);
      return;
    }
    if (picks.includes(id)) {
      setSelection((s) => s.filter((x) => x !== id));
    } else {
      if (picks.length >= MAX_VOTES) {
        flash('Three votes maximum — deselect one first.', true);
        return;
      }
      setSelection((s) => [...s.filter((x) => existing.has(x)), id]);
    }
  }

  async function cast() {
    if (busy) return;
    if (!user) {
      flash('Register first so the ballot can be attributed.', true);
      goRegister();
      return;
    }
    if (voted) {
      flash('You already voted.', true);
      return;
    }
    if (!picks.length) {
      flash('Pick at least one project.', true);
      return;
    }
    setBusy(true);
    try {
      await api('/ballot', 'POST', { projectIds: picks });
      flash(`Ballot recorded — ${picks.length} vote${picks.length > 1 ? 's' : ''} counted. Results at 5:20.`);
      setSelection(() => []);
    } catch (err) {
      flash(errMsg(err), true);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const voteOn = state.phase === 'vote';

  return (
    <section className={'view' + (on ? ' on' : '')} id="v-vote">
      <div className="sec-h">
        <h2>Peer vote</h2>
        <p>Three votes each, cast during the second networking session. You cannot vote for your own team.</p>
      </div>
      <div id="voteLocked" className="locked" style={{ display: voteOn ? 'none' : 'block' }}>
        <div className="lk">🔒</div>
        <h3>Voting opens at 4:00 p.m.</h3>
        <p>Walk the room, look at what people built, then come back.</p>
        {me.isAdmin && (
          <button type="button" className="btn p" onClick={() => onJumpPhase('vote')}>Jump to voting phase</button>
        )}
      </div>
      <div id="voteOpen" style={{ display: voteOn ? 'block' : 'none' }}>
        {needsVerify && (
          <div className="note">
            Confirm your email first — click the link in the confirmation email we sent to {user!.email}. Lost it? Request a
            new link on the Register page.
          </div>
        )}
        <div className="vote-bar">
          <div className="vt">{voted ? 'Ballot locked in' : 'Votes remaining'}</div>
          <div className="pips" id="pips">
            {Array.from({ length: MAX_VOTES }, (_, i) => (
              <span key={i} className={'pip' + (i < MAX_VOTES - picks.length ? ' on' : '')}></span>
            ))}
          </div>
          <button type="button" className="btn" id="btnCastVotes" onClick={cast}>Cast my votes</button>
        </div>
        <Msg id="voteMsg" state={msg} />
        <div className="vgrid" id="voteGrid">
          {state.projects.map((p) => {
            const own = p.id === myTeam;
            const sel = picks.includes(p.id);
            return (
              <article
                key={p.id}
                className={'vcard' + (sel ? ' sel' : '') + (own ? ' own' : '')}
                role={own ? undefined : 'button'}
                tabIndex={own ? undefined : 0}
                aria-pressed={own ? undefined : sel}
                onClick={own ? undefined : () => toggle(p.id)}
                onKeyDown={
                  own
                    ? undefined
                    : (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggle(p.id);
                        }
                      }
                }
              >
                <div className="vh">
                  <div>
                    <span className="id mono" style={{ fontSize: '11px' }}>{p.code}</span>
                    <h3 style={{ fontSize: '17px', lineHeight: 1.15, marginTop: '4px' }}>{p.title}</h3>
                  </div>
                  <div className="vbox">{sel ? '✓' : ''}</div>
                </div>
                <p style={{ fontSize: '13px', fontWeight: 500, color: '#4A4458', marginBottom: '9px' }}>{p.blurb}</p>
                <div className="tags" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {p.fields.map((k) => {
                    const f = fieldOf(k);
                    return <span key={k} className={'tag ' + f.c}>{f.n}</span>;
                  })}
                </div>
                {own && (
                  <p style={{ fontSize: '11.5px', fontWeight: 800, marginTop: '9px', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                    Your team — not votable
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
