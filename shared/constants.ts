// Constants shared by the client (web/) and the server (server/).
// Keep this file free of imports so both toolchains can consume it.

export const PHASES = ['reg', 'build', 'vote', 'result'] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABEL: Record<Phase, string> = {
  reg: 'Registration open',
  build: 'Build in progress',
  vote: 'Voting open',
  result: 'Results announced',
};

export const FIELDS = [
  { k: 'cs', n: 'Computer Science', c: 't-cs' },
  { k: 'bio', n: 'Biology', c: 't-bio' },
  { k: 'env', n: 'Environmental', c: 't-env' },
  { k: 'hum', n: 'Humanities', c: 't-hum' },
  { k: 'art', n: 'Art & Music', c: 't-art' },
  { k: 'soc', n: 'Social Science', c: 't-soc' },
  { k: 'phy', n: 'Physics & Math', c: 't-phy' },
] as const;
export type FieldKey = (typeof FIELDS)[number]['k'];
export const FIELD_KEYS: readonly string[] = FIELDS.map((f) => f.k);

export const SKILLS: readonly string[] = [
  'Python', 'Web / JS', 'Embedded C', 'Data & stats', 'Design',
  'Hardware', 'Writing', 'Field research', 'Audio', 'Never coded before',
];

export const INSTITUTIONS: readonly string[] = [
  'Kenyon College',
  'Denison University',
  'Oberlin College',
  'Ohio Wesleyan University',
  'The College of Wooster',
  'Other Ohio institution',
];

export const MAX_VOTES = 3;
export const TEAM_CAP_MIN = 2;
export const TEAM_CAP_MAX = 5;

/** Display code for a project id, e.g. 7 -> "P-07". */
export function projectCode(id: number): string {
  return 'P-' + String(id).padStart(2, '0');
}

/**
 * Printable ASCII only (0x21-0x7E, no spaces, no control characters), exactly one "@", a dot in the domain.
 * ASCII-only also keeps JS toLowerCase() and Postgres lower() in agreement.
 */
export const EMAIL_RE = /^[\x21-\x3f\x41-\x7e]+@[\x21-\x3f\x41-\x7e]+\.[\x21-\x3f\x41-\x7e]+$/;
