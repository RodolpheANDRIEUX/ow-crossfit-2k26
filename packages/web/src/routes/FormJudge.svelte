<script lang="ts">
  import type { CurrentAssignment } from '@ow/shared';
  import { runs } from '../lib/runs.svelte.ts';
  import Chrono from '../components/Chrono.svelte';

  interface Props {
    assignment: CurrentAssignment;
    crew: { role: string; judgeName: string }[];
  }
  let { assignment, crew }: Props = $props();

  const run = $derived(assignment.run);
  const snapshot = $derived(runs.get(run.id));
  const status = $derived(snapshot?.run.status ?? run.status);
  const finished = $derived(snapshot?.state.finished ?? false);
  const index = $derived(snapshot?.state.currentIndex ?? 0);
  const exercise = $derived(assignment.exercises[index] ?? null);
  const progress = $derived(snapshot?.state.exercises[index] ?? null);
  const counterName = $derived(crew.find((c) => c.role === 'counter')?.judgeName ?? null);
</script>

<!-- Le juge de forme n'a rien a manipuler : son travail se fait les yeux sur
     l'athlete. L'ecran reste volontairement muet — juste de quoi se situer
     d'un coup d'oeil s'il le faut. -->
<main>
  <div class="badge">Juge de forme</div>

  <h1>{assignment.team.name}</h1>
  <p class="exercise">
    {#if finished}
      Workout terminé
    {:else if exercise}
      {exercise.name} · {index + 1}/{assignment.exercises.length}
    {/if}
  </p>

  <p class="brief">
    Regarde l'exécution, pas ton téléphone.<br />
    Une répétition non conforme : fais signe à
    <strong>{counterName ?? 'le compteur'}</strong> pour qu'il l'annule.
  </p>

  <div class="glance">
    {#if progress && !finished}
      <span class="num">{progress.score}/{progress.targetPoints}</span>
      <span class="sep">·</span>
    {/if}
    <span class="num">
      <Chrono
        segments={snapshot?.run.segments ?? run.segments}
        frozenMs={finished ? snapshot?.state.elapsedMs : null}
        running={status === 'running'}
      />
    </span>
  </div>
</main>

<style>
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px 20px calc(24px + env(safe-area-inset-bottom));
    text-align: center;
  }
  .badge {
    padding: 5px 14px;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  h1 {
    font-size: clamp(26px, 7vw, 36px);
    font-weight: 600;
    letter-spacing: -0.03em;
    margin-top: 6px;
  }
  .exercise {
    color: var(--muted);
    font-size: 16px;
    margin-top: -4px;
  }
  .brief {
    max-width: 340px;
    margin-top: 14px;
    line-height: 1.5;
    color: var(--muted);
    font-size: 15px;
  }
  .brief strong {
    color: var(--text);
    font-weight: 600;
  }
  /* Score et chrono : discrets, on ne veut pas capter son regard. */
  .glance {
    margin-top: 20px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    color: var(--muted-2);
  }
  .sep {
    opacity: 0.5;
  }
</style>
