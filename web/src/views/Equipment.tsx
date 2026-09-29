import { useState } from 'react';
import { api, errMsg, type AppState, type Me } from '../api';
import { Msg } from '../components/Msg';
import { useFlash } from '../useFlash';

export type Cart = Record<string, number>;

interface Props {
  on: boolean;
  state: AppState;
  me: Me;
  cart: Cart;
  setCart: (fn: (c: Cart) => Cart) => void;
  refresh: () => Promise<void>;
}

export function Equipment({ on, state, me, cart, setCart, refresh }: Props) {
  const [msg, flash] = useFlash();
  const [busy, setBusy] = useState(false);
  const teamId = me.user?.projectId ?? null;
  const team = teamId ? state.projects.find((p) => p.id === teamId) : undefined;
  const n = Object.values(cart).reduce((s, q) => s + q, 0);

  function minus(key: string) {
    setCart((c) => {
      const q = (c[key] ?? 0) - 1;
      const next = { ...c };
      if (q > 0) next[key] = q;
      else delete next[key];
      return next;
    });
  }

  function plus(key: string, name: string, available: number) {
    if (!teamId) {
      flash('Join or post a project first — the desk issues one pick-list per team.', true);
      return;
    }
    if ((cart[key] ?? 0) >= available) {
      flash(`No more ${name} in stock.`, true);
      return;
    }
    setCart((c) => ({ ...c, [key]: (c[key] ?? 0) + 1 }));
  }

  async function submit() {
    if (busy) return;
    if (!teamId || !team) {
      flash('Join or post a project first.', true);
      return;
    }
    if (!n) {
      flash('Your pick list is empty.', true);
      return;
    }
    setBusy(true);
    try {
      await api('/equipment/requests', 'POST', { items: cart });
      flash(`Pick list sent — ${n} items reserved for ${team.title}. Collect them at the desk from 10:00.`);
      setCart(() => ({}));
    } catch (err) {
      flash(errMsg(err), true);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  return (
    <section className={'view' + (on ? ' on' : '')} id="v-equip">
      <div className="sec-h">
        <h2>Equipment desk</h2>
        <p>Checked out per team during the first networking session and returned before the closing. Stock is live.</p>
      </div>
      <div className="note">
        Requests are tied to a team. Join or post a project first, then come back — the desk prints one pick-list per team.
      </div>
      <Msg id="eqMsg" state={msg} />
      <div className="eq" id="eqGrid">
        {state.equipment.map((it) => {
          const q = cart[it.key] ?? 0;
          const left = Math.max(0, it.available - q);
          return (
            <div className="item" key={it.key}>
              <div className="nm">{it.name}</div>
              <div className={'st' + (left <= 4 ? ' low' : '')}>
                {left} of {it.stock} available
              </div>
              <div className="qty">
                <button type="button" aria-label={`Remove one ${it.name}`} onClick={() => minus(it.key)}>–</button>
                <div className="v" aria-live="polite">{q}</div>
                <button type="button" aria-label={`Add one ${it.name}`} onClick={() => plus(it.key, it.name, it.available)}>+</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="cart">
        <div className="c-l">
          Pick list — <em id="cartCount">{n}{n === 1 ? ' item' : ' items'}</em> for{' '}
          <em id="cartTeam">{team ? `${team.title} (${team.code})` : 'no team yet'}</em>
        </div>
        <button type="button" className="btn sm" id="btnClearCart" onClick={() => setCart(() => ({}))}>Clear</button>
        <button type="button" className="btn sm" id="btnSubmitCart" style={{ background: 'var(--lime)' }} onClick={submit}>
          Send to equipment desk
        </button>
      </div>
    </section>
  );
}
