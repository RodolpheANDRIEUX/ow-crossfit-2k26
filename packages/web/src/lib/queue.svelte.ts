import type { Op, RunSnapshot } from '@ow/shared';
import { api, ApiError } from './api.ts';
import { syncClock } from './clock.ts';
import { runs } from './runs.svelte.ts';
import { storage, type StoredOp } from './storage.ts';

interface OpsResponse {
  accepted: string[];
  rejected: { id: string; reason: string }[];
  /** Les operations acceptees, telles qu'enregistrees par le serveur. */
  ops: Op[];
  snapshots: RunSnapshot[];
  serverNow: number;
}

/** Au-dela, on considere qu'un tap ancien confirme n'a plus d'utilite locale. */
const KEEP_ACKED_MS = 36 * 3600 * 1000;

/**
 * File d'attente des taps : ecriture locale d'abord, envoi ensuite.
 *
 * Le comptage ne depend jamais du reseau. La synchronisation est idempotente
 * (l'identifiant est genere ici), donc un renvoi apres coupure ne cree pas de
 * doublon et un tap ne peut pas etre perdu.
 */
class OpQueue {
  ops = $state<StoredOp[]>([]);
  ready = $state(false);
  syncing = $state(false);
  lastSyncAt = $state<number | null>(null);
  lastError = $state<string | null>(null);

  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #backoff = 1000;
  #started = false;

  get pending(): StoredOp[] {
    return this.ops.filter((op) => !op.acked);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  async init(): Promise<void> {
    if (this.ready) return;
    const store = await storage();
    const saved = await store.all();
    // Menage des confirmations anciennes : la file reste legere.
    const stale = saved.filter((op) => op.acked && Date.now() - op.createdAt > KEEP_ACKED_MS);
    if (stale.length) await store.remove(stale.map((op) => op.id));
    const staleIds = new Set(stale.map((op) => op.id));
    this.ops = saved.filter((op) => !staleIds.has(op.id));
    this.ready = true;
    this.start();
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    setInterval(() => void this.flush(), 4000);
    window.addEventListener('online', () => void this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.flush();
    });
  }

  /** Enregistre un tap : memoire (affichage immediat) puis disque, puis reseau. */
  async add(op: Op): Promise<void> {
    const stored: StoredOp = { ...op, acked: false, createdAt: Date.now() };
    this.ops.push(stored);
    const store = await storage();
    await store.put([{ ...stored }]);
    this.scheduleFlush(120);
  }

  /**
   * Fusionne au journal local des operations connues du serveur : historique
   * au chargement, actions des autres arbitres recues en temps reel.
   *
   * Un meme identifiant n'existe qu'une fois : une operation deja presente ici
   * est simplement marquee confirmee (le serveur l'a bien recue, meme si la
   * reponse a notre envoi s'est perdue). Synchrone : l'ecran ne voit jamais
   * d'etat intermediaire.
   */
  #merge(serverOps: Op[]): StoredOp[] {
    const byId = new Map(this.ops.map((op) => [op.id, op]));
    const changed: StoredOp[] = [];
    const fresh: StoredOp[] = [];
    for (const op of serverOps) {
      const local = byId.get(op.id);
      if (local) {
        if (!local.acked) {
          local.acked = true;
          changed.push({ ...local });
        }
      } else {
        const stored: StoredOp = { ...op, acked: true, createdAt: op.clientTs };
        byId.set(op.id, stored);
        fresh.push(stored);
        changed.push(stored);
      }
    }
    if (fresh.length) this.ops.push(...fresh);
    return changed;
  }

  async seed(serverOps: Op[]): Promise<void> {
    const changed = this.#merge(serverOps);
    if (changed.length === 0) return;
    const store = await storage();
    await store.put(changed);
  }

  /**
   * Journal d'un passage. `since` : instant de la derniere remise a zero par
   * l'organisation — ce qui a ete fait avant est ecarte, exactement comme le
   * fait le serveur.
   */
  forRun(runId: string, since: number | null = null): StoredOp[] {
    return this.ops.filter((op) => op.runId === runId && (since === null || op.clientTs >= since));
  }

  scheduleFlush(delay = 0): void {
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      void this.flush();
    }, delay);
  }

  async flush(): Promise<void> {
    if (this.syncing || !this.ready) return;
    const batch = this.pending.slice(0, 200);
    if (batch.length === 0) return;

    this.syncing = true;
    const sentAt = Date.now();
    try {
      const res = await api<OpsResponse>('/api/ops', {
        method: 'POST',
        body: {
          ops: batch.map((op) => ({
            id: op.id,
            runId: op.runId,
            type: op.type,
            exerciseId: op.exerciseId,
            memberId: op.memberId,
            variantId: op.variantId,
            clientTs: op.clientTs,
            targetOpId: op.targetOpId,
          })),
        },
      });
      syncClock(res.serverNow, sentAt, Date.now());

      // Photo, confirmations et refus dans le meme tour de boucle, avant tout
      // acces disque : l'ecran ne voit jamais un etat a moitie mis a jour.
      runs.applyAll(res.snapshots);
      const changed = this.#merge(res.ops ?? []);
      const accepted = new Set(res.accepted);
      for (const op of this.ops) {
        if (accepted.has(op.id) && !op.acked) {
          op.acked = true;
          changed.push({ ...op });
        }
      }
      // Un tap refuse par le serveur (passage disparu, variante supprimee)
      // sort du journal : il ne doit ni compter ici, ni bloquer la file.
      const rejected = new Set(res.rejected.map((r) => r.id));
      if (rejected.size > 0) this.ops = this.ops.filter((op) => !rejected.has(op.id));

      const store = await storage();
      await store.put(changed.filter((op) => !rejected.has(op.id)));
      if (rejected.size > 0) await store.remove([...rejected]);

      this.lastSyncAt = Date.now();
      this.lastError = res.rejected.length ? `${res.rejected.length} tap(s) refusé(s)` : null;
      this.#backoff = 1000;
      // Lot suivant s'il en reste : on vide la file d'un trait.
      if (this.pending.length > 0) this.scheduleFlush(50);
      return;
    } catch (error) {
      // Rien n'est jete : les taps restent en file et repartiront.
      this.lastError =
        error instanceof ApiError && error.status === 401
          ? 'Session expirée — reconnecte-toi'
          : 'Hors-ligne — les taps sont en attente';
      this.#backoff = Math.min(this.#backoff * 2, 15000);
      this.scheduleFlush(this.#backoff);
    } finally {
      this.syncing = false;
    }
  }
}

export const queue = new OpQueue();
