import type { FlashState } from '../useFlash';

export function Msg({ id, state }: { id?: string; state: FlashState }) {
  const cls = 'msg' + (state.on ? (state.bad ? ' bad' : ' ok') : '');
  return (
    <div id={id} className={cls} role={state.on ? (state.bad ? 'alert' : 'status') : undefined}>
      {state.text}
    </div>
  );
}
