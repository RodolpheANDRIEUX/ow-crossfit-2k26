import { api, getRole, getToken, setToken } from './api.ts';
import { queue } from './queue.svelte.ts';
import { realtime } from './realtime.svelte.ts';
import { scopedKey } from './scope.ts';

const NAME_KEY = scopedKey('ow.name');

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

class Session {
  token = $state<string | null>(getToken());
  role = $state<'admin' | 'judge' | null>(getRole());
  displayName = $state(readName());

  get authenticated(): boolean {
    return this.token !== null;
  }

  async loginJudge(memberId: string, code: string): Promise<void> {
    const res = await api<{ token: string; member: { name: string }; teamName: string }>(
      '/api/auth/judge',
      { method: 'POST', body: { memberId, code } },
    );
    this.#apply(res.token, 'judge', res.member.name);
  }

  async loginAdmin(code: string): Promise<void> {
    const res = await api<{ token: string }>('/api/auth/admin', {
      method: 'POST',
      body: { code },
    });
    this.#apply(res.token, 'admin', 'Organisation');
  }

  #apply(token: string, role: 'admin' | 'judge', name: string): void {
    setToken(token, role);
    this.token = token;
    this.role = role;
    this.displayName = name;
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // sans stockage, le nom se reaffichera a la prochaine connexion
    }
    void queue.init();
    realtime.connect();
  }

  logout(): void {
    setToken(null);
    this.token = null;
    this.role = null;
    realtime.disconnect();
  }
}

export const session = new Session();
