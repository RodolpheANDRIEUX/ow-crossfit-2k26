<script lang="ts">
  import type { CurrentAssignment, EventConfig } from '@ow/shared';
  import { formatDuration } from '@ow/shared';
  import { advanceNotice } from '../lib/advance.svelte.ts';
  import { nowTs } from '../lib/clock.ts';
  import { queue } from '../lib/queue.svelte.ts';
  import { runs } from '../lib/runs.svelte.ts';
  import { timerQueue } from '../lib/timerQueue.svelte.ts';
  import { uid } from '../lib/uid.ts';
  import { currentIndex, localState, railItems, workoutView } from '../lib/workout.ts';
  import Chrono from '../components/Chrono.svelte';
  import ExerciseRail from '../components/ExerciseRail.svelte';

  interface Props {
    assignment: CurrentAssignment;
    event: EventConfig;
    crew: { role: string; judgeName: string }[];
  }
  let { assignment, event, crew }: Props = $props();

  const run = $derived(assignment.run);
  const snapshot = $derived(runs.get(run.id));
  const status = $derived(snapshot?.run.status ?? run.status);
  const segments = $derived(snapshot?.run.segments ?? run.segments);
  const resetAt = $derived(snapshot?.run.resetAt ?? run.resetAt ?? null);
  const running = $derived(status === 'running');
  const finished = $derived(snapshot?.state.finished ?? false);
  const needed = $derived(event.minRepsPerMember);

  // Etat recalcule sur le journal local (voir localState) : la case repond au
  // doigt meme sans reseau. L'epreuve affichee est la premiere pas encore
  // validee ; des qu'elle l'est, les cases passent a la suivante.
  // (pas de variable nommee `state` : Svelte y verrait un store et casserait les $state du composant)
  const workout = $derived(
    localState(queue.forRun(run.id, resetAt), assignment.exercises, assignment.team.members, needed, segments),
  );
  const views = $derived(workoutView(assignment.exercises, assignment.team.members, workout));
  const index = $derived(currentIndex(workout));
  const current = $derived(index === -1 ? null : (views[index] ?? null));
  const rail = $derived(railItems(views, index === -1 ? views.length : index));
  const notice = advanceNotice(
    () => index,
    () => views,
  );
  const counterName = $derived(crew.find((c) => c.role === 'counter')?.judgeName ?? null);

  const statusText = $derived.by(() => {
    if (finished) return 'Terminé — temps figé';
    if (!current) return 'Tout est validé — synchronisation en cours';
    if (current.pointsReached && !current.minimumsComplete) return 'Objectif atteint : valide les minimums';
    if (current.minimumsComplete && !current.pointsReached) return 'Minimums validés — objectif en cours';
    if (running) return 'En cours';
    if (status === 'paused') return 'En pause';
    return 'Prêt à partir';
  });

  /**
   * Aide au comptage, strictement locale : jamais envoyee, jamais melangee au
   * score de l'equipe. Elle sert seulement a ne pas perdre le fil des
   * repetitions qu'on observe. Une par epreuve et par membre.
   */
  let tally = $state<Record<string, number>>({});
  const tallyKey = (exerciseId: string, memberId: string) => `${exerciseId}:${memberId}`;

  function bump(memberId: string) {
    if (!current) return;
    const key = tallyKey(current.exercise.id, memberId);
    const next = (tally[key] ?? 0) + 1;
    tally[key] = next;
    navigator.vibrate?.(8);
    if (next >= needed && !current.minimums.find((m) => m.member.id === memberId)?.validated) {
      void toggle(memberId, false);
    }
  }

  /** Coche ou decoche le minimum d'un membre sur l'epreuve en cours. */
  async function toggle(memberId: string, validated: boolean) {
    if (!current) return;
    const exerciseId = current.exercise.id;

    if (validated) {
      // Decocher = annuler la validation, exactement comme une rep annulee.
      const ops = queue.forRun(run.id, resetAt);
      const cancelled = new Set(ops.filter((op) => op.type === 'undo').map((op) => op.targetOpId));
      const validation = ops
        .filter(
          (op) =>
            op.type === 'min' &&
            op.memberId === memberId &&
            op.exerciseId === exerciseId &&
            !cancelled.has(op.id),
        )
        .sort((a, b) => b.clientTs - a.clientTs)[0];
      if (!validation) return;
      await queue.add({
        id: uid(),
        runId: run.id,
        type: 'undo',
        exerciseId: null,
        memberId: null,
        variantId: null,
        points: 0,
        clientTs: nowTs(),
        targetOpId: validation.id,
        judgeMemberId: null,
      });
      tally[tallyKey(exerciseId, memberId)] = 0;
    } else {
      await queue.add({
        id: uid(),
        runId: run.id,
        type: 'min',
        exerciseId,
        memberId,
        variantId: null,
        points: 0,
        clientTs: nowTs(),
        targetOpId: null,
        judgeMemberId: null,
      });
    }
    navigator.vibrate?.(14);
  }

  function toggleChrono() {
    if (finished) return;
    void timerQueue.send(run.id, running ? 'pause' : 'start', nowTs());
  }
</script>

<main>
  <ExerciseRail items={rail} />

  <section class="top">
    <div class="titles">
      <h1>{current ? current.exercise.name : 'Workout terminé'}</h1>
      <p class="muted tiny">
        {assignment.team.name}{counterName ? ` · compteur : ${counterName}` : ''}
      </p>
    </div>
    {#if current}
      <div class="score card num">
        {current.score} <span class="sep">/</span>
        {current.exercise.targetPoints}
      </div>
    {/if}
  </section>

  <div class="stage">
    <!-- Le chrono est l'objet de ce poste : c'est lui qui prend la place. -->
    <section class="clock" class:done={finished}>
      <div class="digits">
        <Chrono {segments} frozenMs={finished ? snapshot?.state.elapsedMs : null} {running} />
      </div>
      <p class="status" class:ok={Boolean(notice.message)}>{notice.message ?? statusText}</p>
      <button
        class="control"
        onclick={toggleChrono}
        disabled={finished}
        aria-label={running ? 'Mettre en pause' : 'Démarrer'}
      >
        {#if running}
          <span class="bars"><i></i><i></i></span>
        {:else}
          <span class="play"></span>
        {/if}
      </button>
    </section>

    {#if current}
      <!-- Valider que chacun a fait ses repetitions minimum sur cette epreuve. -->
      <section class="mins">
        {#each current.minimums as { member, validated } (member.id)}
          <div class="slot">
            <button class="min" class:ok={validated} onclick={() => toggle(member.id, validated)}>
              <span class="check">{validated ? '✓' : ''}</span>
              <span class="name">{member.name}</span>
              <span class="sub tiny">{validated ? `${needed} reps validées` : `minimum ${needed} reps`}</span>
            </button>
            {#if !validated}
              <button
                class="tally"
                title="Aide au comptage — local, sans effet sur le score"
                onclick={() => bump(member.id)}
              >
                {tally[tallyKey(current.exercise.id, member.id)] ?? 0}/{needed}
              </button>
            {/if}
          </div>
        {/each}
      </section>
    {:else}
      <section class="splits card">
        {#each views as view (view.exercise.id)}
          <div class="split">
            <span>{view.exercise.name}</span>
            <span class="num">{formatDuration(view.splitMs)}</span>
          </div>
        {/each}
      </section>
    {/if}
  </div>

  {#if timerQueue.pending.length > 0}
    <span class="pill warn pending">Commande chrono en attente</span>
  {/if}
</main>

<style>
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 10px 16px calc(12px + env(safe-area-inset-bottom));
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .titles {
    min-width: 0;
  }
  h1 {
    font-size: clamp(24px, 5.5vw, 38px);
    font-weight: 600;
    letter-spacing: -0.03em;
  }
  .score {
    padding: 10px 26px;
    font-size: clamp(30px, 7vw, 48px);
    font-weight: 650;
    line-height: 1;
    background: var(--surface-2);
    border-color: var(--line);
    flex: none;
  }
  .sep {
    color: var(--muted-2);
    font-weight: 400;
  }

  .stage {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
  }

  .clock {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 12px 0;
  }
  .digits {
    font-size: clamp(48px, 13.5vw, 132px);
    line-height: 1;
    white-space: nowrap;
  }
  .clock.done .digits {
    color: var(--accent);
  }
  .status {
    color: var(--muted);
    font-size: 15px;
    text-align: center;
  }
  .status.ok {
    color: var(--accent);
    font-weight: 600;
  }
  .control {
    width: 84px;
    height: 84px;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--surface-2);
    display: grid;
    place-items: center;
    cursor: pointer;
    touch-action: manipulation;
    flex: none;
  }
  .control:active {
    background: var(--surface-3);
  }
  .control:disabled {
    opacity: 0.35;
  }
  .bars {
    display: flex;
    gap: 8px;
  }
  .bars i {
    width: 9px;
    height: 28px;
    border-radius: 2px;
    background: var(--text);
    display: block;
  }
  .play {
    width: 0;
    height: 0;
    border-left: 26px solid var(--accent);
    border-top: 16px solid transparent;
    border-bottom: 16px solid transparent;
    margin-left: 7px;
  }

  .mins {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .slot {
    position: relative;
    display: flex;
  }
  .min {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 108px;
    padding: 12px 10px;
    border-radius: var(--r-lg);
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    touch-action: manipulation;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }
  .min:active {
    transform: scale(0.99);
  }
  .min.ok {
    background: rgb(34 197 94 / 0.12);
    border-color: rgb(34 197 94 / 0.5);
  }
  .check {
    font-size: 22px;
    line-height: 1;
    color: var(--accent);
    min-height: 22px;
  }
  .name {
    font-size: clamp(14px, 3.4vw, 18px);
    font-weight: 600;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    color: var(--muted);
  }
  .min.ok .sub {
    color: var(--accent);
  }
  /* Aide au comptage : volontairement discrete, pour ne pas etre confondue
     avec le score de l'equipe. */
  .tally {
    position: absolute;
    top: 5px;
    right: 6px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--muted-2);
    background: var(--surface-2);
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    padding: 3px 9px;
    cursor: pointer;
    touch-action: manipulation;
  }
  .tally:active {
    background: var(--surface-3);
    color: var(--text);
  }

  .splits {
    padding: 8px 14px;
    display: flex;
    flex-direction: column;
  }
  .split {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid var(--line-soft);
    font-size: 15px;
  }
  .split:last-child {
    border-bottom: none;
  }
  .split .num {
    color: var(--accent);
    font-weight: 600;
  }
  .pending {
    align-self: center;
  }

  /* Telephone tenu a l'horizontale : chrono a gauche, cases a droite, tout
     tient sans defilement. */
  @media (max-height: 540px) {
    main {
      gap: 8px;
      padding: 8px 16px calc(10px + env(safe-area-inset-bottom));
    }
    h1 {
      font-size: clamp(20px, 4.2vw, 30px);
    }
    .score {
      padding: 6px 20px;
      font-size: clamp(26px, 5vw, 40px);
    }
    .stage {
      flex-direction: row;
      align-items: stretch;
    }
    .clock {
      flex: 1;
      gap: 8px;
      padding: 0;
    }
    .digits {
      font-size: clamp(34px, 7vw, 64px);
    }
    .control {
      width: 58px;
      height: 58px;
    }
    .bars i {
      height: 20px;
      width: 7px;
    }
    .play {
      border-left-width: 20px;
      border-top-width: 12px;
      border-bottom-width: 12px;
    }
    .mins,
    .splits {
      flex: 1.2;
    }
    .min {
      min-height: 0;
      padding: 8px;
    }
  }
</style>
