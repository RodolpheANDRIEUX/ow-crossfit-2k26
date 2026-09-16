import { computeRunState, elapsedAt, type ComputeOptions } from './scoring.ts';
import type { Op, RunState, TrackPoint } from './types.ts';

/** Version du format des editions archivees (voir EditionV1). */
export const EDITION_SCHEMA_VERSION = 1;

/**
 * Avancement dans le workout, de 0 (depart) a 1 (arrivee) : epreuves validees
 * plus la part de l'objectif atteinte sur l'epreuve en cours.
 */
export function workoutProgress(state: RunState): number {
  const count = state.exercises.length;
  if (count === 0) return 0;
  if (state.finished) return 1;
  const current = state.exercises[state.currentIndex];
  const fraction = current ? Math.min(1, current.score / current.targetPoints) : 0;
  return (state.currentIndex + fraction) / count;
}

const byTime = (a: Op, b: Op) => a.clientTs - b.clientTs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Trace de course d'une equipe, input par input.
 *
 * Le journal est rejoue dans l'ordre des horodatages : apres chaque action
 * (repetition, validation, annulation), on recalcule l'etat avec le moteur
 * officiel et on note l'avancement au temps de chrono correspondant. Une
 * annulation fait donc reculer l'equipe, comme elle a recule en vrai.
 *
 * Le temps est celui du chrono de l'equipe : des equipes parties dans des
 * series differentes se retrouvent sur la meme ligne de depart.
 */
export function buildTrack(ops: Op[], options: ComputeOptions): TrackPoint[] {
  const ordered = [...ops].sort(byTime);
  const track: TrackPoint[] = [[0, 0, 0]];

  for (let i = 0; i < ordered.length; i++) {
    const op = ordered[i]!;
    // Plusieurs actions au meme instant : un seul point, apres la derniere.
    if (ordered[i + 1]?.clientTs === op.clientTs) continue;

    const state = computeRunState(ordered.slice(0, i + 1), options);
    const progress = Math.round(workoutProgress(state) * 10000) / 10000;
    const last = track[track.length - 1]!;
    if (progress === last[1] && state.currentIndex === last[2]) continue;

    const t = Math.max(last[0], Math.round(elapsedAt(options.segments, op.clientTs)));
    track.push([t, progress, state.currentIndex]);
  }
  return track;
}

/** Position d'une equipe a un instant de chrono donne (dernier point atteint). */
export function positionAt(track: TrackPoint[], t: number): { progress: number; exerciseIndex: number } {
  const first = track[0];
  if (!first || t < first[0]) return { progress: 0, exerciseIndex: 0 };
  let low = 0;
  let high = track.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (track[middle]![0] <= t) low = middle;
    else high = middle - 1;
  }
  const point = track[low]!;
  return { progress: point[1], exerciseIndex: point[2] };
}
