import type { RunSnapshot } from '@ow/shared';

/**
 * Dernier etat connu de chaque passage, cote serveur.
 *
 * Les photos plus anciennes que celle deja affichee sont ignorees : une reponse
 * HTTP et une notification WebSocket peuvent se croiser, le score ne doit
 * jamais reculer a l'ecran.
 */
class RunsStore {
  snapshots = $state<Record<string, RunSnapshot>>({});

  apply(snapshot: RunSnapshot): void {
    const current = this.snapshots[snapshot.run.id];
    if (current && current.serverNow > snapshot.serverNow) return;
    this.snapshots[snapshot.run.id] = snapshot;
  }

  applyAll(snapshots: RunSnapshot[]): void {
    for (const snapshot of snapshots) this.apply(snapshot);
  }

  get(runId: string | null | undefined): RunSnapshot | null {
    return runId ? (this.snapshots[runId] ?? null) : null;
  }
}

export const runs = new RunsStore();
