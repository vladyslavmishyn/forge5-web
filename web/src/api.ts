import type { Phase } from '../../shared/constants';

export interface Member {
  name: string;
  college: string;
}
export interface Project {
  id: number;
  code: string;
  title: string;
  blurb: string;
  fields: string[];
  cap: number;
  need: string;
  members: Member[];
}
export interface EquipmentItem {
  key: string;
  name: string;
  stock: number;
  available: number;
}
export interface AppState {
  phase: Phase;
  stats: { students: number; teams: number; colleges: number; seats: number };
  projects: Project[];
  equipment: EquipmentItem[];
}
export interface MeUser {
  name: string;
  email: string;
  college: string;
  major: string;
  skills: string[];
  wantsTeam: boolean;
  projectId: number | null;
  emailVerified: boolean;
  hasVoted: boolean;
  votes: number[];
}
export interface Me {
  user: MeUser | null;
  isAdmin: boolean;
  verificationRequired: boolean;
}
export interface ResultRow {
  id: number;
  code: string;
  title: string;
  fields: string[];
  memberCount: number;
  votes: number;
}
export interface AdminRequest {
  id: number;
  projectId: number;
  projectCode: string;
  projectTitle: string;
  requestedBy: string | null;
  createdAt: string;
  returnedAt: string | null;
  items: { key: string; name: string; qty: number }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** JSON API call. Non-GET requests always send a JSON body (the server's CSRF check requires it). */
export async function api<T>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method, credentials: 'same-origin', headers, cache: 'no-store' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch('/api' + path, init);
  } catch {
    throw new ApiError('Network error — check your connection and try again.', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status}).`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
