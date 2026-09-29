import { useState } from 'react';
import { FIELDS } from '../../../shared/constants';
import { api, errMsg, type AppState, type Me, type Project } from '../api';
import { Msg } from '../components/Msg';
import { useFlash } from '../useFlash';
import { colorFor, fieldOf, initials, shortCollege } from '../util';

type Filter = 'all' | 'open' | 'mine';

interface Props {
  on: boolean;
  state: AppState;
  me: Me;
  refresh: () => Promise<void>;
  goRegister: () => void;
  goEquipment: () => void;
}

export function Projects({ on, state, me, refresh, goRegister, goEquipment }: Props) {
  const [msg, flash] = useFlash();
  const [filter, setFilter] = useState<Filter>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [blurb, setBlurb] = useState('');
  const [fields, setFields] = useState<Record<string, boolean>>({});
  const [cap, setCap] = useState('4');
  const [need, setNeed] = useState('');
  const [busy, setBusy] = useState(false);

  const user = me.user;
  const myTeam = user?.projectId ?? null;

  const list = state.projects.filter((p) => {
    if (filter === 'open') return p.members.length < p.cap;
    if (filter === 'mine') return p.id === myTeam;
    return true;
  });

  async function join(p: Project) {
    if (busy) return;
    if (!user) {
      flash('Register first — it takes two minutes.', true);
      goRegister();
      return;
    }
    if (myTeam) {
      flash('Leave your current team before joining another.', true);
      return;
    }
    if (p.members.length >= p.cap) {
      flash('That team just filled up.', true);
      return;
    }
    setBusy(true);
    try {
      await api(`/projects/${p.id}/join`, 'POST', {});
      flash(`You joined ${p.title}. Equipment requests are now open for your team.`);
    } catch (err) {
      flash(errMsg(err), true);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function leave(p: Project) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/projects/${p.id}/leave`, 'POST', {});
      flash(`You left ${p.title}.`);
    } catch (err) {
      flash(errMsg(err), true);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function createProject() {
    if (busy) return;
    if (!user) {
      flash('Register first, then post a project.', true);
      goRegister();
      return;
    }
    if (myTeam) {
      flash('You are already on a team.', true);
      return;
    }
    const t = title.trim();
    const b = blurb.trim();
    const fs = FIELDS.map((f) => f.k).filter((k) => fields[k]);
    if (!t || !b) {
      flash('A title and a one-line pitch are required.', true);
      return;
    }
    if (fs.length < 2) {
      flash('Pick at least two fields — Forge5 projects are interdisciplinary by rule.', true);
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ id: number; code: string }>('/projects', 'POST', {
        title: t,
        blurb: b,
        fields: fs,
        cap: Number(cap),
        need: need.trim(),
      });
      setFormOpen(false);
      setTitle('');
      setBlurb('');
      setNeed('');
      setFields({});
      flash(`Project posted as ${res.code}. Other students can now join it.`);
    } catch (err) {
      flash(errMsg(err), true);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  return (
    <section className={'view' + (on ? ' on' : '')} id="v-proj">
      <div className="sec-h">
        <h2>Project placement</h2>
        <p>Every project pairs computer science with something else. Join one with an open seat, or post your own.</p>
      </div>
      <Msg id="projMsg" state={msg} />
      <div className="filters">
        <span className="lb2">Filter</span>
        {(
          [
            ['all', 'All'],
            ['open', 'Open seats'],
            ['mine', 'My team'],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button key={f} type="button" className={'chip' + (filter === f ? ' on' : '')} data-f={f}
            aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }}></div>
        <button type="button" className="btn r sm" id="btnNewProj" onClick={() => setFormOpen((o) => !o)}>
          + Post a project
        </button>
      </div>

      <div id="newProjForm" className="card"
        style={{ display: formOpen ? 'block' : 'none', marginBottom: '20px', background: '#FBFAFF' }}>
        <h3 style={{ fontSize: '19px', textTransform: 'uppercase', marginBottom: '13px' }}>Post a project</h3>
        <div className="field">
          <label className="lb" htmlFor="p-title">Title</label>
          <input type="text" id="p-title" placeholder="Kokosing sediment sensor buoy" maxLength={80} value={title}
            onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label className="lb" htmlFor="p-blurb">One-line pitch</label>
          <textarea id="p-blurb" maxLength={280}
            placeholder="What are you building, and what does the non-CS half of it involve?" value={blurb}
            onChange={(e) => setBlurb(e.target.value)} />
        </div>
        <div className="field">
          <label className="lb" id="fields-lb">Fields it crosses</label>
          <div className="chips" id="fieldChips" role="group" aria-labelledby="fields-lb">
            {FIELDS.map((f) => (
              <button key={f.k} type="button" className={'chip' + (fields[f.k] ? ' on' : '')} aria-pressed={!!fields[f.k]}
                onClick={() => setFields((o) => ({ ...o, [f.k]: !o[f.k] }))}>
                {f.n}
              </button>
            ))}
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label className="lb" htmlFor="p-size">Team size cap</label>
            <select id="p-size" value={cap} onChange={(e) => setCap(e.target.value)}>
              <option>2</option>
              <option>3</option>
              <option>4</option>
              <option>5</option>
            </select>
          </div>
          <div className="field">
            <label className="lb" htmlFor="p-need">Looking for</label>
            <input type="text" id="p-need" placeholder="Someone who knows soldering" maxLength={120} value={need}
              onChange={(e) => setNeed(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '11px' }}>
          <button type="button" className="btn p" id="btnCreateProj" onClick={createProject}>Post it</button>
          <button type="button" className="btn w" id="btnCancelProj" onClick={() => setFormOpen(false)}>Cancel</button>
        </div>
      </div>

      <div className="pgrid" id="projGrid">
        {list.length === 0 ? (
          <div className="card"><b>Nothing here yet.</b></div>
        ) : (
          list.map((p) => (
            <ProjectCard key={p.id} p={p} myTeam={myTeam}
              onJoin={() => join(p)} onLeave={() => leave(p)} onEquipment={goEquipment} />
          ))
        )}
      </div>
    </section>
  );
}

function ProjectCard({
  p,
  myTeam,
  onJoin,
  onLeave,
  onEquipment,
}: {
  p: Project;
  myTeam: number | null;
  onJoin: () => void;
  onLeave: () => void;
  onEquipment: () => void;
}) {
  const isMine = p.id === myTeam;
  const full = p.members.length >= p.cap;
  const open = p.cap - p.members.length;
  return (
    <article className="proj">
      <div className="top">
        <span className="id">{p.code}</span>
        {isMine ? (
          <span className="mine">Your team</span>
        ) : full ? (
          <span className="full">Team full</span>
        ) : (
          <span className="tag" style={{ background: 'var(--lime)' }}>
            {open} seat{open > 1 ? 's' : ''} open
          </span>
        )}
      </div>
      <div className="body">
        <h3>{p.title}</h3>
        <p className="blurb">{p.blurb}</p>
        <div className="tags">
          {p.fields.map((k) => {
            const f = fieldOf(k);
            return <span key={k} className={'tag ' + f.c}>{f.n}</span>;
          })}
        </div>
        <div className="roster">
          <div className="rh"><span>Team</span><span>{p.members.length} / {p.cap}</span></div>
          {p.members.map((m, i) => (
            <div className="mem" key={i}>
              <span className="av" style={{ background: colorFor(m.name) }}>{initials(m.name)}</span>
              <span>{m.name}</span>
              <span style={{ fontSize: '11px', color: '#5C5470', fontWeight: 700 }}>{shortCollege(m.college)}</span>
            </div>
          ))}
          <div className="slots">
            {Array.from({ length: p.cap }, (_, i) => (
              <span key={i} className={'slot' + (i < p.members.length ? ' f' : '')}></span>
            ))}
          </div>
          {p.need && (
            <p style={{ fontSize: '12px', fontWeight: 700, marginTop: '10px', color: 'var(--purple)' }}>
              Looking for: {p.need}
            </p>
          )}
        </div>
      </div>
      <div className="foot">
        {isMine ? (
          <>
            <button type="button" className="btn r sm" onClick={onLeave}>Leave team</button>
            <button type="button" className="btn w sm" onClick={onEquipment}>Equipment →</button>
          </>
        ) : (
          <button type="button" className="btn sm" disabled={full || !!myTeam} onClick={onJoin}>
            {full ? 'Full' : myTeam ? 'Already on a team' : 'Join team'}
          </button>
        )}
      </div>
    </article>
  );
}
