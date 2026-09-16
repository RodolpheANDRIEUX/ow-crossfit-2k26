import { untrack } from 'svelte';
import type { ExerciseView } from './workout.ts';

/**
 * Annonce le passage a l'epreuve suivante.
 *
 * Quand l'ecran change de boutons ou de cases sous les doigts de l'arbitre,
 * il doit comprendre pourquoi en un coup d'oeil : un message bref et une
 * vibration. A appeler pendant l'initialisation d'un composant.
 */
export function advanceNotice(getIndex: () => number, getViews: () => ExerciseView[]) {
  let message = $state<string | null>(null);
  let previous: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const index = getIndex();
    // Seul le changement d'epreuve declenche l'annonce, pas chaque tap.
    untrack(() => {
      const before = previous;
      previous = index;
      if (before === null || before === -1) return;
      if (index !== -1 && index <= before) return;

      const views = getViews();
      const done = views[before]?.exercise.name ?? '';
      const next = index === -1 ? null : views[index]?.exercise.name;
      message = next ? `${done} ✓ — suivante : ${next}` : `${done} ✓`;
      navigator.vibrate?.([30, 60, 30]);
      clearTimeout(timer);
      timer = setTimeout(() => (message = null), 3500);
    });
  });

  return {
    get message() {
      return message;
    },
  };
}
