import { useCallback, useEffect, useRef, useState } from 'react';

export interface FlashState {
  text: string;
  bad: boolean;
  on: boolean;
}

/** Mirrors the mock's flash(): message shows with ok/bad styling for 4.2 s. */
export function useFlash(): [FlashState, (text: string, bad?: boolean) => void] {
  const [st, setSt] = useState<FlashState>({ text: '', bad: false, on: false });
  const timer = useRef<number | undefined>(undefined);
  const flash = useCallback((text: string, bad = false) => {
    window.clearTimeout(timer.current);
    setSt({ text, bad, on: true });
    timer.current = window.setTimeout(() => setSt((s) => ({ ...s, on: false })), 4200);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [st, flash];
}
