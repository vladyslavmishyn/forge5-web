import type { AppState } from '../api';

const SCHEDULE: [string, string, string, string][] = [
  ['9:00 – 9:50', 'Opening', 'Organizer welcome · invited faculty remarks · rules · Q&A', 'var(--bright)'],
  ['10:00 – 11:00', 'Networking I', 'Team formation, project registration, equipment checkout, forms', 'var(--lime)'],
  ['11:00 – 1:00', 'Working session I', 'Build', '#fff'],
  ['1:00 – 2:00', 'Lunch', 'Peirce / catered', 'var(--sunset)'],
  ['2:00 – 4:00', 'Working session II', 'Build', '#fff'],
  ['4:00 – 5:00', 'Networking II', 'Peer demos, discussion, and voting through this portal', 'var(--river)'],
  ['5:00 – 6:00', 'Closing', 'Presentations · winners · closing remarks · photographs', 'var(--red)'],
];

export function Dashboard({ state, on }: { state: AppState; on: boolean }) {
  const s = state.stats;
  return (
    <section className={'view' + (on ? ' on' : '')} id="v-home">
      <div className="stats">
        <div className="stat"><div className="n" id="sStudents">{s.students}</div><div className="l">Students registered</div></div>
        <div className="stat"><div className="n" id="sTeams">{s.teams}</div><div className="l">Teams formed</div></div>
        <div className="stat"><div className="n" id="sColleges">{s.colleges}</div><div className="l">Colleges represented</div></div>
        <div className="stat"><div className="n" id="sSeats">{s.seats}</div><div className="l">Open team seats</div></div>
      </div>

      <div className="sec-h">
        <h2>Run of the day</h2>
        <p>One Saturday, 9:00 a.m. to 6:00 p.m., Chalmers Library 330. Everything below runs through this portal.</p>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div id="sched">
          {SCHEDULE.map((r, i) => (
            <div
              key={r[0]}
              style={{
                display: 'flex',
                gap: '14px',
                alignItems: 'baseline',
                padding: '11px 16px',
                background: r[3],
                borderBottom: i < SCHEDULE.length - 1 ? '3px solid var(--ink)' : undefined,
                flexWrap: 'wrap',
              }}
            >
              <b className="mono" style={{ fontSize: '12.5px', minWidth: '112px' }}>{r[0]}</b>
              <b className="blk" style={{ fontSize: '15px', textTransform: 'uppercase', minWidth: '160px' }}>{r[1]}</b>
              <span style={{ fontSize: '13.5px', fontWeight: 600, flex: 1, minWidth: '180px' }}>{r[2]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sec-h" style={{ marginTop: '30px' }}>
        <h2>The rules</h2>
        <p>Short version. The full text goes out with the confirmation email.</p>
      </div>
      <div className="grid2">
        <div className="card" style={{ background: 'var(--lime)' }}>
          <h3 style={{ fontSize: '18px', textTransform: 'uppercase', marginBottom: '8px' }}>AI is allowed — credit it</h3>
          <p style={{ fontSize: '14px', fontWeight: 600 }}>
            Every AI tool is permitted: coding agents, image models, whatever helps. The one condition is that your
            submission names what you used and where. Uncredited AI is the only disqualifier.
          </p>
        </div>
        <div className="card">
          <h3 style={{ fontSize: '18px', textTransform: 'uppercase', marginBottom: '8px' }}>Teams of 2 to 5</h3>
          <p style={{ fontSize: '14px', fontWeight: 600 }}>
            Cross-college teams are encouraged and cross-discipline teams are the point. Register solo and join a team
            here, or bring one. Hardware is checked out per team from the equipment desk.
          </p>
        </div>
      </div>
    </section>
  );
}
