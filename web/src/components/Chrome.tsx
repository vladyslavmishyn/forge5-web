import type { MouseEvent } from 'react';
import { PHASE_LABEL, PHASES, type Phase } from '../../../shared/constants';
import type { View } from '../routes';

const PHASE_BUTTON: Record<Phase, string> = {
  reg: '1 · Register',
  build: '2 · Build',
  vote: '3 · Vote',
  result: '4 · Results',
};

export function Header({
  phase,
  isAdmin,
  onHome,
  onPhase,
}: {
  phase: Phase;
  isAdmin: boolean;
  onHome: () => void;
  onPhase: (p: Phase) => void;
}) {
  return (
    <header>
      <div className="hdr">
        <a
          className="logo"
          href="/"
          onClick={(e: MouseEvent) => {
            e.preventDefault();
            onHome();
          }}
        >
          <svg viewBox="-3 -3 116 116" aria-hidden="true">
            <rect x="7" y="7" width="100" height="100" fill="#231F20" />
            <rect x="0" y="0" width="100" height="100" fill="#4B2E84" stroke="#231F20" strokeWidth="5.5" />
            <polygon points="22,34 85,34 85,48 61,48 59,68 77,68 77,82 23,82 23,68 41,68 39,48 22,48 3,41" fill="#F1EDFF" />
            <g stroke="#F1EDFF" strokeLinecap="butt">
              <line x1="55.44" y1="20.02" x2="54.12" y2="1.07" strokeWidth="7" />
              <line x1="51.30" y1="21.53" x2="42.48" y2="9.39" strokeWidth="6" />
              <line x1="60.00" y1="21.07" x2="68.00" y2="7.22" strokeWidth="6" />
              <line x1="49.61" y1="25.15" x2="40.47" y2="21.09" strokeWidth="5" />
              <line x1="62.18" y1="24.71" x2="71.89" y2="19.55" strokeWidth="5" />
            </g>
          </svg>
          <div>
            <div className="wm blk">
              FORGE<span className="five">5</span>
            </div>
            <div className="sub">Five Colleges of Ohio · Kenyon</div>
          </div>
        </a>
        <div className="hdr-spacer"></div>
        <div className="live">
          <span className="dot"></span>
          <span id="liveLabel">{PHASE_LABEL[phase]}</span>
        </div>
        {isAdmin && (
          <div className="phase-ctl" role="group" aria-label="Event phase">
            {PHASES.map((p) => (
              <button key={p} type="button" data-ph={p} aria-pressed={p === phase} onClick={() => onPhase(p)}>
                {PHASE_BUTTON[p]}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

const TABS: { v: View; label: string }[] = [
  { v: 'home', label: 'Dashboard' },
  { v: 'reg', label: 'Register' },
  { v: 'proj', label: 'Projects' },
  { v: 'equip', label: 'Equipment' },
  { v: 'vote', label: 'Vote' },
  { v: 'results', label: 'Results' },
];

export function Nav({
  view,
  projectCount,
  isAdmin,
  onView,
}: {
  view: View;
  projectCount: number;
  isAdmin: boolean;
  onView: (v: View) => void;
}) {
  const tabs = isAdmin ? [...TABS, { v: 'admin' as View, label: 'Admin' }] : TABS;
  return (
    <nav>
      <div className="navin" role="tablist">
        {tabs.map((t) => (
          <button key={t.v} type="button" role="tab" data-v={t.v} aria-selected={view === t.v} onClick={() => onView(t.v)}>
            {t.label}
            {t.v === 'proj' && (
              <>
                {' '}
                <span className="badge" id="nProj">
                  {projectCount}
                </span>
              </>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

const TICKS = [
  'Forge5 · one Saturday · Chalmers 330',
  'Teams of 2–5',
  'All AI allowed — credit it',
  'Five Colleges of Ohio',
  'Equipment desk opens 10:00',
  'Peer vote 4:00–5:00',
  'Winners 5:20',
];

export function Ticker() {
  return (
    <div className="ticker" aria-hidden="true">
      <div id="tick">
        {[0, 1].flatMap((r) => TICKS.map((t, i) => <span key={`${r}-${i}`}>{t} ✦</span>))}
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="wrap fin">
        <span>Forge5 · Portal · Kenyon College</span>
        <span>Organizers: Vladyslav Mishyn &amp; Quan Doan · Advisor: Prof. Skon</span>
        <span>Your details are used only to run this event</span>
      </div>
    </footer>
  );
}
