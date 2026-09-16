import type { EventConfig, Exercise, Heat, RunSnapshot, Team } from '@ow/shared';
import { api, ApiError } from './api.ts';
import { syncClock } from './clock.ts';
import { runs } from './runs.svelte.ts';
import { toast } from './toast.svelte.ts';

export interface FullState {
  event: EventConfig;
  teams: Team[];
  exercises: Exercise[];
  heats: Heat[];
  snapshots: RunSnapshot[];
  serverNow: number;
}

class AdminState {
  data = $state<FullState | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  async load(): Promise<void> {
    this.loading = true;
    const sentAt = Date.now();
    try {
      const data = await api<FullState>('/api/state');
      syncClock(data.serverNow, sentAt, Date.now());
      this.data = data;
      runs.applyAll(data.snapshots);
      this.error = null;
    } catch (err) {
      this.error = err instanceof ApiError ? err.message : 'Chargement impossible';
    } finally {
      this.loading = false;
    }
  }

  /** Envoie une modification puis rafraichit : l'ecran reflete toujours la base. */
  async mutate<T>(
    path: string,
    options: { method?: string; body?: unknown; success?: string } = {},
  ): Promise<T | null> {
    try {
      const result = await api<T>(path, { method: options.method ?? 'POST', body: options.body });
      await this.load();
      if (options.success) toast.show(options.success);
      return result;
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Action impossible');
      return null;
    }
  }

  teamById(id: string): Team | undefined {
    return this.data?.teams.find((t) => t.id === id);
  }

  memberById(id: string | null): { name: string; teamName: string; canJudgeForm: boolean } | null {
    if (!id) return null;
    for (const team of this.data?.teams ?? []) {
      const member = team.members.find((m) => m.id === id);
      if (member) {
        return { name: member.name, teamName: team.name, canJudgeForm: member.canJudgeForm };
      }
    }
    return null;
  }

  /** Le workout d'une equipe, dans sa version la plus fraiche (temps reel si disponible). */
  snapshotFor(teamId: string): RunSnapshot | null {
    const snapshot = this.data?.snapshots.find((s) => s.run.teamId === teamId);
    return snapshot ? (runs.get(snapshot.run.id) ?? snapshot) : null;
  }
}

export const admin = new AdminState();
