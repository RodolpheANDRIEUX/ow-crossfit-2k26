import { scopedKey } from './scope.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = scopedKey('ow.token');
const ROLE_KEY = scopedKey('ow.role');

let token: string | null = null;
try {
  token = localStorage.getItem(TOKEN_KEY);
} catch {
  token = null;
}

export function getToken(): string | null {
  return token;
}

export function setToken(value: string | null, role?: 'admin' | 'judge'): void {
  token = value;
  try {
    if (value) {
      localStorage.setItem(TOKEN_KEY, value);
      if (role) localStorage.setItem(ROLE_KEY, role);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ROLE_KEY);
    }
  } catch {
    // stockage indisponible (navigation privee) : la session vit en memoire
  }
}

export function getRole(): 'admin' | 'judge' | null {
  try {
    return (localStorage.getItem(ROLE_KEY) as 'admin' | 'judge' | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Appel API. Un echec reseau leve une ApiError de statut 0 : l'appelant sait
 * ainsi distinguer « hors-ligne » (on reessaiera) de « refuse » (on abandonne).
 */
export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, 'Réseau indisponible');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, (data as any)?.error ?? `Erreur ${res.status}`);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
