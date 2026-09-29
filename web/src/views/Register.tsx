import { useState } from 'react';
import { EMAIL_RE, INSTITUTIONS, SKILLS, type Phase } from '../../../shared/constants';
import { api, errMsg, type Me } from '../api';
import { Msg } from '../components/Msg';
import { useFlash } from '../useFlash';

interface Props {
  on: boolean;
  phase: Phase;
  me: Me;
  onRegistered: (me: Me) => Promise<void> | void;
  onSignOut: () => Promise<void>;
  goProjects: () => void;
}

export function Register({ on, phase, me, onRegistered, onSignOut, goProjects }: Props) {
  const [msg, flash] = useFlash();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [college, setCollege] = useState('');
  const [major, setMajor] = useState('');
  const [diet, setDiet] = useState('');
  const [ai, setAi] = useState(false);
  const [waiver, setWaiver] = useState(false);
  const [solo, setSolo] = useState(false);
  const [skills, setSkills] = useState<Record<string, boolean>>({});
  const [errs, setErrs] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkErr, setLinkErr] = useState(false);

  const user = me.user;
  const open = phase === 'reg' || phase === 'build';
  const needsVerify = !!user && me.verificationRequired && !user.emailVerified;

  function resetForm() {
    setName('');
    setEmail('');
    setCollege('');
    setMajor('');
    setDiet('');
    setAi(false);
    setWaiver(false);
    setSolo(false);
    setSkills({});
    setErrs({});
  }

  async function register() {
    if (busy) return;
    const e = {
      name: name.trim() === '',
      email: !EMAIL_RE.test(email.trim()),
      college: college === '',
    };
    setErrs(e);
    if (e.name || e.email || e.college) {
      flash('Name, a valid college email, and an institution are required.', true);
      return;
    }
    if (!ai || !waiver) {
      flash('You need to accept the AI credit policy and the waiver.', true);
      return;
    }
    setBusy(true);
    try {
      const res = await api<Me>('/register', 'POST', {
        name: name.trim(),
        email: email.trim(),
        college,
        major: major.trim(),
        skills: SKILLS.filter((s) => skills[s]),
        diet: diet.trim(),
        aiPolicy: true,
        waiver: true,
        wantsTeam: solo,
      });
      resetForm();
      setJustRegistered(true);
      flash('Registration accepted.');
      await onRegistered(res);
    } catch (err) {
      flash(errMsg(err), true);
    } finally {
      setBusy(false);
    }
  }

  async function registerSomeoneElse() {
    try {
      await onSignOut();
      resetForm();
      setJustRegistered(false);
    } catch (err) {
      flash(errMsg(err), true);
    }
  }

  async function sendLink() {
    const v = linkEmail.trim();
    if (!EMAIL_RE.test(v)) {
      setLinkErr(true);
      flash('Enter the email you registered with.', true);
      return;
    }
    setLinkErr(false);
    try {
      await api('/auth/link', 'POST', { email: v });
      setLinkEmail('');
      flash('If that email is registered, a sign-in link is on its way.');
    } catch (err) {
      flash(errMsg(err), true);
    }
  }

  let doneTxt = '';
  if (user) {
    doneTxt =
      `${user.name} · ${user.college} · ${user.major}. ` +
      (justRegistered
        ? `A confirmation and the full rules are on their way to ${user.email}`
        : `Signed in as ${user.email}`) +
      (user.wantsTeam ? '. You are listed as looking for a team.' : '.');
    if (needsVerify) {
      doneTxt += ' Click the link in the confirmation email before voting opens.';
    }
  }

  return (
    <section className={'view' + (on ? ' on' : '')} id="v-reg">
      <div className="sec-h">
        <h2>Register</h2>
        <p>Two minutes. You do not need a team or an idea yet — you can pick both up in the first networking session.</p>
      </div>
      <Msg id="regMsg" state={msg} />

      {!user && !open && (
        <div className="locked">
          <div className="lk">🔒</div>
          <h3>Registration is closed</h3>
          <p>
            {phase === 'vote'
              ? 'Teams are locked once voting starts. Already registered? Get a sign-in link below to vote.'
              : 'The event is over — thanks for coming. Already registered? You can still sign in below.'}
          </p>
        </div>
      )}

      {!user && open && (
        <div id="regFormWrap" className="card">
          <div className="grid2">
            <div className="field">
              <label className="lb" htmlFor="f-name">Full name</label>
              <input type="text" id="f-name" placeholder="Ada Lovelace" maxLength={80} autoComplete="name"
                className={errs.name ? 'err' : undefined} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label className="lb" htmlFor="f-email">College email</label>
              <input type="email" id="f-email" placeholder="you@kenyon.edu" maxLength={254} autoComplete="email"
                className={errs.email ? 'err' : undefined} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label className="lb" htmlFor="f-college">Institution</label>
              <select id="f-college" className={errs.college ? 'err' : undefined} value={college}
                onChange={(e) => setCollege(e.target.value)}>
                <option value="">Select…</option>
                {INSTITUTIONS.map((i) => <option key={i}>{i}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="lb" htmlFor="f-major">Major / field</label>
              <input type="text" id="f-major" placeholder="Neuroscience" maxLength={80} value={major}
                onChange={(e) => setMajor(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label className="lb" id="skills-lb">What do you bring? (pick any)</label>
            <div className="chips" id="skillChips" role="group" aria-labelledby="skills-lb">
              {SKILLS.map((s) => (
                <button key={s} type="button" className={'chip' + (skills[s] ? ' on' : '')} aria-pressed={!!skills[s]}
                  onClick={() => setSkills((o) => ({ ...o, [s]: !o[s] }))}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="lb" htmlFor="f-diet">Dietary needs for lunch</label>
            <input type="text" id="f-diet" placeholder="Vegetarian, none, etc." maxLength={120} value={diet}
              onChange={(e) => setDiet(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" id="f-ai" checked={ai} onChange={(e) => setAi(e.target.checked)} />
            <span><b>AI credit policy</b>I will credit every AI tool I use in my submission.</span>
          </label>
          <label className="check">
            <input type="checkbox" id="f-waiver" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} />
            <span><b>Waiver &amp; photo release</b>I accept the event waiver and agree to photographs during the closing session.</span>
          </label>
          <label className="check">
            <input type="checkbox" id="f-solo" checked={solo} onChange={(e) => setSolo(e.target.checked)} />
            <span><b>Place me on a team</b>Optional — surface me to teams that are still looking for members.</span>
          </label>
          <div style={{ display: 'flex', gap: '11px', flexWrap: 'wrap', marginTop: '6px' }}>
            <button type="button" className="btn p" id="btnReg" onClick={register}>
              Submit registration
            </button>
          </div>
        </div>
      )}

      {user && (
        <div id="regDone">
          <div className="card" style={{ background: 'var(--lime)' }}>
            <h3 style={{ fontSize: '24px', textTransform: 'uppercase', marginBottom: '7px' }}>You're in.</h3>
            <p style={{ fontSize: '14.5px', fontWeight: 600, marginBottom: '14px' }} id="regDoneTxt">{doneTxt}</p>
            <div style={{ display: 'flex', gap: '11px', flexWrap: 'wrap' }}>
              <button type="button" className="btn p" onClick={goProjects}>Find a team →</button>
              <button type="button" className="btn w" id="btnReset" onClick={registerSomeoneElse}>Register someone else</button>
            </div>
          </div>
        </div>
      )}

      {(!user || needsVerify) && (
        <div className="card" style={{ marginTop: '20px', background: '#FBFAFF' }}>
          <h3 style={{ fontSize: '17px', textTransform: 'uppercase', marginBottom: '10px' }}>
            {user ? 'Need a new confirmation link?' : 'Already registered?'}
          </h3>
          <div style={{ display: 'flex', gap: '11px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: '220px' }}>
              <label className="lb" htmlFor="f-link-email">College email</label>
              <input type="email" id="f-link-email" placeholder="you@kenyon.edu" maxLength={254} autoComplete="email"
                className={linkErr ? 'err' : undefined} value={linkEmail}
                onChange={(e) => setLinkEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void sendLink(); }} />
            </div>
            <button type="button" className="btn w sm" style={{ alignSelf: 'flex-end' }} onClick={sendLink}>
              Email me a sign-in link
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
