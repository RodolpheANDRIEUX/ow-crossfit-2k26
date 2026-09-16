import type { RunSnapshot } from '@ow/shared';
import { api, ApiError } from './api.ts';
import { runs } from './runs.svelte.ts';
import { scopedKey } from './scope.ts';

interface TimerCommand {
  runId: string;
  action: 'start' | 'pause' | 'resume';
  at: number;
}

const KEY = scopedKey('ow.timer-queue');

function load(): TimerCommand[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as TimerCommand[];
  } catch {
    return [];
  }
}

/**
 * Commandes de chrono en attente.
 *
 * Un depart de chrono ne doit jamais dependre du reseau : la commande porte
 * son propre horodatage (`at`), donc un envoi differe de trente secondes
 * enregistre quand meme l'heure exacte du depart. Les commandes sont rejouees
 * dans l'ordre, et chacune est sans effet si elle a deja ete appliquee.
 */
class TimerQueue {
  pending = $state<TimerCommand[]>(load());
  #sending = false;

  constructor() {
    if (typeof window !== 'undefined') {
      setInterval(() => void this.flush(), 3000);
      window.addEventListener('online', () => void this.flush());
    }
  }

  async send(runId: string, action: TimerCommand['action'], at: number): Promise<void> {
    this.pending.push({ runId, action, at });
    this.#persist();
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.#sending || this.pending.length === 0) return;
    this.#sending = true;
    try {
      while (this.pending.length > 0) {
        const command = this.pending[0] as TimerCommand;
        try {
          const res = await api<{ snapshot: RunSnapshot }>(`/api/runs/${command.runId}/timer`, {
            method: 'POST',
            body: { action: command.action, at: command.at },
          });
          runs.apply(res.snapshot);
        } catch (error) {
          // Refus definitif (edition terminee, passage supprime) : la commande n'a
          // plus d'objet. La garder bloquerait toutes les suivantes pour toujours.
          const permanent =
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500 &&
            ![401, 408, 429].includes(error.status);
          if (!permanent) throw error;
        }
        this.pending.shift();
        this.#persist();
      }
    } catch {
      // reseau absent : on retentera, l'horodatage reste celui du geste
    } finally {
      this.#sending = false;
    }
  }

  #persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify($state.snapshot(this.pending)));
    } catch {
      // sans stockage, la commande reste en memoire pour cette session
    }
  }
}

export const timerQueue = new TimerQueue();
