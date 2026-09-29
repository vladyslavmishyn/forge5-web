export type View = 'home' | 'reg' | 'proj' | 'equip' | 'vote' | 'results' | 'admin' | 'signin';

export const PATHS: Record<View, string> = {
  home: '/',
  reg: '/register',
  proj: '/projects',
  equip: '/equipment',
  vote: '/vote',
  results: '/results',
  admin: '/admin',
  signin: '/signin',
};

export function viewFromPath(path: string): View | null {
  const p = path.replace(/\/+$/, '') || '/';
  for (const [v, vp] of Object.entries(PATHS)) if (vp === p) return v as View;
  return null;
}
