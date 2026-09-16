import { computeRunState } from '@ow/shared';
import type { Exercise, Member, Op, RunState, Segment } from '@ow/shared';

/**
 * Etat du workout recalcule sur ce telephone, avec le meme moteur que le
 * serveur, a partir du journal local : les actions de cet appareil (envoyees
 * ou non) et celles des autres arbitres recues en temps reel.
 *
 * Chaque operation porte un identifiant unique, le meme partout : elle ne
 * figure qu'une fois dans le journal, donc elle ne peut pas etre comptee deux
 * fois, quel que soit l'ordre dans lequel arrivent reponses et diffusions.
 * C'est ce qui garantit que l'ecran ne change jamais d'epreuve a tort sous le
 * doigt de l'arbitre — et qu'il avance quand meme sans reseau.
 */
export function localState(
  ops: Op[],
  exercises: Exercise[],
  members: Member[],
  minRepsPerMember: number,
  segments: Segment[],
): RunState {
  return computeRunState(ops, {
    exercises: exercises.map((e) => ({ id: e.id, targetPoints: e.targetPoints })),
    minRepsPerMember,
    memberIds: members.map((m) => m.id),
    segments,
  });
}

/** Avancement d'une epreuve tel que l'affiche l'ecran d'un arbitre. */
export interface ExerciseView {
  exercise: Exercise;
  index: number;
  score: number;
  pointsReached: boolean;
  minimums: { member: Member; validated: boolean }[];
  minimumsComplete: boolean;
  /** Points et minimums reunis. */
  complete: boolean;
  splitMs: number | null;
}

export function workoutView(exercises: Exercise[], members: Member[], state: RunState): ExerciseView[] {
  return exercises.map((exercise, index) => {
    const progress = state.exercises.find((e) => e.exerciseId === exercise.id);
    const pointsReached = progress?.pointsReached ?? false;
    const minimumsComplete = progress?.minimumsComplete ?? false;
    return {
      exercise,
      index,
      score: progress?.score ?? 0,
      pointsReached,
      minimums: members.map((member) => ({
        member,
        validated: progress?.minimums.find((m) => m.memberId === member.id)?.validated ?? false,
      })),
      minimumsComplete,
      complete: pointsReached && minimumsComplete,
      splitMs: progress?.splitMs ?? null,
    };
  });
}

/**
 * Epreuve en cours pour l'equipe : celle que le compteur compte et que
 * l'arbitre au chrono valide — les deux ecrans montrent toujours la meme.
 *
 * C'est le moteur partage qui la designe : la premiere epreuve pas encore
 * validee. Une epreuve n'est validee que lorsque son objectif de points ET les
 * minimums de chaque membre sont atteints, donc tant qu'un minimum manque
 * l'equipe reste sur l'epreuve en cours — les repetitions comptees en plus
 * sont justement celles du membre qui n'a pas fait son minimum.
 *
 * -1 : tout est valide.
 */
export function currentIndex(state: RunState): number {
  return state.currentIndex >= state.exercises.length ? -1 : state.currentIndex;
}

export interface RailItem {
  id: string;
  name: string;
  /** done = validee · waiting = points atteints, minimums en attente · current · to do */
  state: 'done' | 'waiting' | 'current' | 'todo';
  splitMs: number | null;
}

export function railItems(views: ExerciseView[], currentIndex: number): RailItem[] {
  return views.map((view, i) => ({
    id: view.exercise.id,
    name: view.exercise.name,
    splitMs: view.splitMs,
    state:
      i === currentIndex ? 'current' : i > currentIndex ? 'todo' : view.complete ? 'done' : 'waiting',
  }));
}
