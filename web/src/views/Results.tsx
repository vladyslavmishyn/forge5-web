import { useEffect, useState } from 'react';
import type { Phase } from '../../../shared/constants';
import { api, errMsg, type ResultRow } from '../api';
import { fieldOf } from '../util';

interface Props {
  on: boolean;
  phase: Phase;
  isAdmin: boolean;
  onJumpPhase: (p: Phase) => void;
}

export function Results({ on, phase, isAdmin, onJumpPhase }: Props) {
  const resOn = phase === 'result';
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!resOn) {
      setRows(null);
      return;
    }
    if (!on && rows) return;
    let cancelled = false;
    api<ResultRow[]>('/results')
      .then((r) => {
        if (!cancelled) {
          setRows(r);
          setError('');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resOn, on]);

  const sorted = rows ?? [];
  const max = sorted.length ? Math.max(1, sorted[0]!.votes) : 1;

  return (
    <section className={'view' + (on ? ' on' : '')} id="v-results">
      <div className="sec-h">
        <h2>Results</h2>
        <p>Announced at 5:20 p.m. by the judges, then photographs.</p>
      </div>
      <div id="resLocked" className="locked" style={{ display: resOn ? 'none' : 'block' }}>
        <div className="lk">🏆</div>
        <h3>Sealed until 5:20 p.m.</h3>
        <p>The tally stays hidden while voting is open.</p>
        {isAdmin && (
          <button type="button" className="btn p" onClick={() => onJumpPhase('result')}>Jump to results phase</button>
        )}
      </div>
      <div id="resOpen" style={{ display: resOn ? 'block' : 'none' }}>
        {error && <div className="msg bad">{error}</div>}
        <div className="podium" id="podium">
          {[1, 0, 2].map((idx) => {
            const p = sorted[idx];
            if (!p) return null;
            const rank = idx + 1;
            return (
              <div key={p.id} className={'pod g' + rank}>
                <div className="rk">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</div>
                <div className="mono" style={{ fontSize: '11px', fontWeight: 700 }}>{p.code}</div>
                <h3>{p.title}</h3>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#4A4458' }}>
                  {p.memberCount}
                  {p.memberCount === 1 ? ' member · ' : ' members · '}
                  {p.fields.map((k) => fieldOf(k).n).join(' × ')}
                </div>
                <div className="vv">{p.votes} votes</div>
              </div>
            );
          })}
        </div>
        <div className="sec-h"><h2 style={{ fontSize: '21px' }}>Full tally</h2></div>
        <div id="tally">
          {sorted.map((p, i) => (
            <div className="rrow" key={p.id}>
              <div className="rn">{i + 1}</div>
              <div className="rt">
                <b>{p.title}</b>
                <small>
                  {p.code} · {p.memberCount}
                  {p.memberCount === 1 ? ' member' : ' members'}
                </small>
              </div>
              <div className="bar"><i style={{ width: Math.round((p.votes / max) * 100) + '%' }}></i></div>
              <div className="vc">{p.votes}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
