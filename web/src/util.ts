import { FIELDS } from '../../shared/constants';

export const COLORS = ['#4B2E84', '#E46551', '#3F7C7C', '#8F80FF', '#CB8FDE', '#231F20'];

export function fieldOf(k: string) {
  return FIELDS.find((f) => f.k === k) ?? { k, n: k, c: '' };
}
export function initials(n: string): string {
  const p = n.trim().split(/\s+/);
  return ((p[0] ?? '')[0] ?? '') + ((p[1] ?? '')[0] ?? '');
}
export function colorFor(n: string): string {
  let s = 0;
  for (let i = 0; i < n.length; i++) s += n.charCodeAt(i);
  return COLORS[s % COLORS.length]!;
}
export const shortCollege = (c: string) => c.replace(/ (College|University)$/, '');
export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
