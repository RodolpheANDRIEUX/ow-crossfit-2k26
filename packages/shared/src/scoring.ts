import type { ExerciseProgress, MemberMinimum, Op, RunState, Segment } from './types.ts';

/**
 * Temps de chrono ecoule a l'instant `ts`, en ne comptant que les periodes
 * pendant lesquelles le chrono tournait (les pauses ne comptent pas).
 */
export function elapsedAt(segments: Segment[], ts: number): number {
  let total = 0;
  for (const seg of segments) {
    if (seg.startedAt >= ts) continue;
    const end = seg.endedAt === null ? ts : Math.min(seg.endedAt, ts);
    if (end > seg.startedAt) total += end - seg.startedAt;
  }
  return total;
}

/** Le chrono tourne-t-il actuellement ? */
export function isTicking(segments: Segment[]): boolean {
  return segments.some((s) => s.endedAt === null);
}

/**
 * Ordre canonique des operations.
 *
 * L'horodatage client fait foi (une rep comptee hors-ligne garde son instant
 * reel), l'identifiant sert d'egalisateur pour que le calcul soit strictement
 * deterministe et identique sur tous les appareils.
 */
function byClientTs(a: Op, b: Op): number {
  return a.clientTs - b.clientTs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface WorkoutExercise {
  id: string;
  targetPoints: number;
}

export interface ComputeOptions {
  /** Les epreuves du workout, dans l'ordre ou elles s'enchainent. */
  exercises: WorkoutExercise[];
  /** Nombre de repetitions que chaque membre doit realiser par epreuve (0 = pas de regle). */
  minRepsPerMember: number;
  /** Membres de l'equipe (definit l'ordre d'affichage et la regle du minimum). */
  memberIds: string[];
  segments: Segment[];
}

/**
 * Recalcule integralement l'etat du workout d'une equipe a partir du journal.
 *
 * Les epreuves s'enchainent. Chacune est validee quand deux conditions tiennent
 * ENSEMBLE : son objectif de points (compte par l'arbitre compteur) et les
 * repetitions minimum des trois membres (cochees par l'arbitre au chrono).
 * Chaque operation porte l'epreuve pour laquelle elle a ete faite, donc un tap
 * synchronise en retard retrouve toujours sa place.
 *
 * Une epreuve ne peut pas etre validee avant la precedente : si les horloges ou
 * une validation tardive placent son instant plus tot, il est ramene a celui de
 * l'epreuve precedente. Les temps intermediaires restent ainsi positifs et leur
 * somme egale toujours le temps total.
 *
 * Pure et rejouable : le serveur et chaque telephone arrivent au meme resultat.
 */
export function computeRunState(ops: Op[], opts: ComputeOptions): RunState {
  const undone = new Set<string>();
  for (const op of ops) {
    if (op.type === 'undo' && op.targetOpId) undone.add(op.targetOpId);
  }

  const team = new Set(opts.memberIds);
  const minimumsRequired = opts.minRepsPerMember > 0 ? opts.memberIds.length : 0;

  const tallies = new Map(
    opts.exercises.map((exercise) => [
      exercise.id,
      {
        score: 0,
        reps: 0,
        validatedAt: new Map<string, number>(),
        pointsReachedAt: null as number | null,
        // Premier instant ou les deux conditions tiennent, independamment des autres epreuves.
        satisfiedAt: null as number | null,
      },
    ]),
  );

  const timeline = ops
    .filter((op) => op.type !== 'undo' && !undone.has(op.id))
    .sort(byClientTs);

  for (const op of timeline) {
    const exercise = opts.exercises.find((e) => e.id === op.exerciseId);
    const tally = op.exerciseId ? tallies.get(op.exerciseId) : undefined;
    if (!exercise || !tally) continue;

    if (op.type === 'rep') {
      tally.score += op.points;
      tally.reps += 1;
    } else if (op.type === 'min' && op.memberId && team.has(op.memberId)) {
      // Une validation rejouee ne compte qu'une fois : on garde la premiere.
      if (!tally.validatedAt.has(op.memberId)) tally.validatedAt.set(op.memberId, op.clientTs);
    }

    if (tally.pointsReachedAt === null && tally.score >= exercise.targetPoints) {
      tally.pointsReachedAt = op.clientTs;
    }
    if (
      tally.satisfiedAt === null &&
      tally.score >= exercise.targetPoints &&
      tally.validatedAt.size >= minimumsRequired
    ) {
      tally.satisfiedAt = op.clientTs;
    }
  }

  const exercises: ExerciseProgress[] = [];
  let previousCompletedAt: number | null = null;
  let chainBroken = false;

  for (const [index, exercise] of opts.exercises.entries()) {
    const tally = tallies.get(exercise.id)!;

    let completedAt: number | null = null;
    if (!chainBroken && tally.satisfiedAt !== null) {
      completedAt =
        previousCompletedAt === null
          ? tally.satisfiedAt
          : Math.max(previousCompletedAt, tally.satisfiedAt);
    } else {
      // Tant qu'une epreuve n'est pas validee, les suivantes ne peuvent pas l'etre.
      chainBroken = true;
    }

    const splitMs =
      completedAt === null
        ? null
        : elapsedAt(opts.segments, completedAt) -
          (index === 0 || previousCompletedAt === null
            ? 0
            : elapsedAt(opts.segments, previousCompletedAt));

    const minimums: MemberMinimum[] = opts.memberIds.map((memberId) => ({
      memberId,
      validated: tally.validatedAt.has(memberId),
      validatedAt: tally.validatedAt.get(memberId) ?? null,
    }));

    exercises.push({
      exerciseId: exercise.id,
      score: tally.score,
      targetPoints: exercise.targetPoints,
      totalReps: tally.reps,
      pointsReached: tally.score >= exercise.targetPoints,
      minimums,
      minimumsComplete: tally.validatedAt.size >= minimumsRequired,
      completedAt,
      splitMs,
    });

    if (completedAt !== null) previousCompletedAt = completedAt;
  }

  const firstOpen = exercises.findIndex((e) => e.completedAt === null);
  const finished = exercises.length > 0 && firstOpen === -1;
  const finishTs = finished ? (exercises[exercises.length - 1]?.completedAt ?? null) : null;

  return {
    exercises,
    currentIndex: firstOpen === -1 ? exercises.length : firstOpen,
    finished,
    finishTs,
    elapsedMs: finishTs === null ? null : elapsedAt(opts.segments, finishTs),
  };
}

/** Formate un temps en MM:SS:CC (centiemes), comme sur les maquettes. */
export function formatChrono(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const cents = Math.floor((safe % 1000) / 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(minutes)} : ${p(seconds)} : ${p(cents)}`;
}

/** Formate un temps en MM:SS (classements). */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const safe = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
