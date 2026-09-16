<script lang="ts">
  import type { CurrentAssignment, EventConfig, Variant } from '@ow/shared';
  import { formatDuration } from '@ow/shared';
  import { advanceNotice } from '../lib/advance.svelte.ts';
  import { api } from '../lib/api.ts';
  import { nowTs } from '../lib/clock.ts';
  import { queue } from '../lib/queue.svelte.ts';
  import { runs } from '../lib/runs.svelte.ts';
  import { toast } from '../lib/toast.svelte.ts';
  import { uid } from '../lib/uid.ts';
  import { imageUrl } from '../lib/images.ts';
  import {
    currentIndex,
    localState,
    railItems,
    workoutView,
    type ExerciseView,
  } from '../lib/workout.ts';
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
  const segments = $derived(snapshot?.run.segments ?? run.segments);
  const resetAt = $derived(snapshot?.run.resetAt ?? run.resetAt ?? null);
  const status = $derived(snapshot?.run.status ?? run.status);
  const finished = $derived(snapshot?.state.finished ?? false);
  const running = $derived(status === 'running');

  // Etat recalcule sur le journal local (voir localState) : l'ecran suit
  // l'epreuve en cours sans attendre le reseau, et ne change jamais d'epreuve a
  // tort. L'equipe ne passe a la suivante qu'une fois l'epreuve validee —
  // objectif de points ET minimums de chaque membre.
  // (pas de variable nommee `state` : Svelte y verrait un store et casserait les $state du composant)
  const workout = $derived(
    localState(
      queue.forRun(run.id, resetAt),
      assignment.exercises,
      assignment.team.members,
      event.minRepsPerMember,
      segments,
    ),
  );
  const views = $derived(workoutView(assignment.exercises, assignment.team.members, workout));
  const index = $derived(currentIndex(workout));
  const current = $derived(index === -1 ? null : (views[index] ?? null));
  const rail = $derived(railItems(views, index === -1 ? views.length : index));
  const notice = advanceNotice(
    () => index,
    () => views,
  );

  const localOps = $derived(queue.forRun(run.id, resetAt));
  const undone = $derived(
    new Set(localOps.filter((op) => op.type === 'undo').map((op) => op.targetOpId)),
  );
  const reps = $derived(
    localOps.filter((op) => op.type === 'rep').sort((a, b) => b.clientTs - a.clientTs),
  );
  const liveReps = $derived(reps.filter((op) => !undone.has(op.id)));
  const currentReps = $derived(
    current ? liveReps.filter((op) => op.exerciseId === current.exercise.id).length : 0,
  );

  // L'epreuve en cours attend ses minimums : le compteur sait pourquoi les
  // boutons ne passent pas a la suivante, et qui doit valider.
  const awaiting = $derived(
    current && current.pointsReached && !current.minimumsComplete ? current : null,
  );
  const timerName = $derived(crew.find((c) => c.role === 'timer')?.judgeName ?? null);
  const formName = $derived(crew.find((c) => c.role === 'form')?.judgeName ?? null);

  let flashes = $state<{ id: string; points: number }[]>([]);
  let historyOpen = $state(false);
  let starting = $state(false);

  async function tap(variant: Variant) {
    await queue.add({
      id: uid(),
      runId: run.id,
      type: 'rep',
      exerciseId: variant.exerciseId,
      memberId: null,
      variantId: variant.id,
      points: variant.points,
      clientTs: nowTs(),
      targetOpId: null,
      judgeMemberId: null,
    });
    navigator.vibrate?.(12);
    const flash = { id: uid(), points: variant.points };
    flashes.push(flash);
    setTimeout(() => (flashes = flashes.filter((f) => f.id !== flash.id)), 700);
  }

  async function undo(targetOpId: string) {
    await queue.add({
      id: uid(),
      runId: run.id,
      type: 'undo',
      exerciseId: null,
      memberId: null,
      variantId: null,
      points: 0,
      clientTs: nowTs(),
      targetOpId,
      judgeMemberId: null,
    });
    navigator.vibrate?.([8, 40, 8]);
  }

  async function startChrono() {
    starting = true;
    try {
      const res = await api<{ snapshot: any }>(`/api/runs/${run.id}/timer`, {
        method: 'POST',
        body: { action: 'start', at: nowTs() },
      });
      runs.apply(res.snapshot);
    } catch {
      toast.show('Impossible de démarrer le chrono sans réseau.');
    } finally {
      starting = false;
    }
  }

  function describe(variantId: string | null): { exercise: string; variant: string } {
    for (const exercise of assignment.exercises) {
      const variant = exercise.variants.find((v) => v.id === variantId);
      if (variant) return { exercise: exercise.name, variant: variant.name };
    }
    return { exercise: '', variant: 'Répétition' };
  }

  function missing(view: ExerciseView): string {
    return view.minimums
      .filter((m) => !m.validated)
      .map((m) => m.member.name)
      .join(', ');
  }

  function clockOf(ts: number): string {
    const start = segments[0]?.startedAt;
    if (!start) return new Date(ts).toLocaleTimeString('fr-FR');
    const s = Math.max(0, Math.round((ts - start) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
</script>

<main>
  <ExerciseRail items={rail} />

  <section class="hero">
    {#if current}
      <p class="step tiny">Épreuve {index + 1} / {views.length}</p>
      <h1>{current.exercise.name}</h1>
      <div class="score num">
        {current.score} <span class="sep">/</span>
        {current.exercise.targetPoints}
      </div>
      <div class="bar" aria-hidden="true">
        <span style="width:{Math.min(100, (current.score / current.exercise.targetPoints) * 100)}%"></span>
      </div>
    {:else}
      <h1>{finished ? 'Workout terminé' : 'Comptage terminé'}</h1>
      {#if finished}
        <div class="score num done">{formatDuration(snapshot?.state.elapsedMs ?? null)}</div>
      {/if}
    {/if}
    <div class="meta">
      <span class="muted">{assignment.team.name}</span>
      <span>·</span>
      <Chrono {segments} frozenMs={finished ? snapshot?.state.elapsedMs : null} {running} />
      {#if current && !current.pointsReached}
        <span>·</span>
        <span class="num">reste {current.exercise.targetPoints - current.score}</span>
      {:else if current}
        <span>·</span>
        <span class="reached">objectif atteint</span>
      {/if}
    </div>
  </section>

  {#if notice.message}
    <p class="banner ok">{notice.message}</p>
  {:else if finished}
    <p class="banner ok">Toutes les épreuves sont validées. Merci !</p>
  {:else if status === 'pending'}
    <div class="banner">
      <span>Chrono non démarré.</span>
      <button class="btn sm" onclick={startChrono} disabled={starting}>Démarrer</button>
    </div>
  {/if}

  {#if awaiting}
    <p class="banner warn">
      Minimum manquant : <strong>{missing(awaiting)}</strong>. {timerName ?? "L'arbitre au chrono"}
      doit valider avant que l'épreuve suivante s'ouvre.
    </p>
  {/if}

  {#if current}
    <div class="pad">
      {#each current.exercise.variants as variant (variant.id)}
        <button class="tap" class:with-image={Boolean(variant.imageId)} onclick={() => tap(variant)}>
          {#if variant.imageId}
            <img class="tap-image" src={imageUrl(variant.imageId)} alt="" />
          {/if}
          <span class="tap-name">{variant.name}</span>
          <span class="tap-points num">+{variant.points}</span>
        </button>
      {/each}
      {#if current.exercise.variants.length === 0}
        <p class="muted empty">Aucune variante configurée pour cette épreuve.</p>
      {/if}
    </div>
  {:else if !finished}
    <p class="muted empty">
      Tous les points sont comptés. Le chrono s'arrêtera dès que les minimums seront validés.
    </p>
  {/if}

  <footer>
    <button
      class="btn"
      onclick={() => liveReps[0] && undo(liveReps[0].id)}
      disabled={liveReps.length === 0}
    >
      ↩ Annuler
    </button>
    <div class="mine">
      <strong class="num">{currentReps}</strong>
      <span class="tiny muted">reps comptées</span>
    </div>
    <button class="btn" onclick={() => (historyOpen = true)}>Historique</button>
  </footer>

  {#if formName}
    <p class="tiny muted crew-note">Juge de forme : {formName} — il te fera signe pour annuler.</p>
  {/if}

  <div class="flashes" aria-hidden="true">
    {#each flashes as flash (flash.id)}
      <span class="flash num">+{flash.points}</span>
    {/each}
  </div>
</main>

{#if historyOpen}
  <div class="sheet-backdrop">
    <button class="scrim" aria-label="Fermer l'historique" onclick={() => (historyOpen = false)}
    ></button>
    <div class="sheet card" role="dialog" aria-modal="true" aria-label="Historique" tabindex="-1">
      <header class="sheet-head">
        <h2>Historique — {assignment.team.name}</h2>
        <button class="btn ghost sm" onclick={() => (historyOpen = false)}>Fermer</button>
      </header>
      <div class="list">
        {#each reps as op (op.id)}
          {@const label = describe(op.variantId)}
          <div class="line" class:cancelled={undone.has(op.id)}>
            <span class="line-time num muted">{clockOf(op.clientTs)}</span>
            <span class="line-name">
              {label.variant}
              <span class="tiny muted">{label.exercise}</span>
            </span>
            <span class="line-pts num">+{op.points}</span>
            {#if undone.has(op.id)}
              <span class="pill">annulé</span>
            {:else}
              <button class="btn ghost sm" onclick={() => undo(op.id)}>Annuler</button>
            {/if}
          </div>
        {:else}
          <p class="muted">Aucune répétition comptée pour l'instant.</p>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 14px calc(14px + env(safe-area-inset-bottom));
    max-width: 560px;
    width: 100%;
    margin: 0 auto;
  }

  .hero {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding-top: 2px;
  }
  .step {
    color: var(--muted-2);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  h1 {
    font-size: clamp(26px, 8vw, 38px);
    font-weight: 600;
    letter-spacing: -0.03em;
  }
  .score {
    font-size: clamp(40px, 13vw, 60px);
    font-weight: 650;
    line-height: 1;
  }
  .score.done {
    color: var(--accent);
  }
  .sep {
    color: var(--muted-2);
    font-weight: 400;
  }
  .bar {
    width: 100%;
    max-width: 320px;
    height: 4px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.25s ease;
  }
  .reached {
    color: var(--accent);
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--muted);
  }

  .banner {
    padding: 10px 14px;
    border-radius: var(--r-md);
    font-size: 14px;
    background: var(--surface);
    border: 1px solid var(--line-soft);
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
  }
  .banner.ok {
    color: var(--accent);
    border-color: rgb(34 197 94 / 0.3);
    background: rgb(34 197 94 / 0.08);
  }
  .banner.warn {
    color: var(--warn);
    border-color: rgb(240 160 32 / 0.3);
    background: rgb(240 160 32 / 0.08);
  }

  /* Boutons de comptage : la seule chose a viser sur le telephone. */
  .pad {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
  }
  .tap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 88px;
    flex: 1;
    padding: 0 22px;
    border: none;
    border-radius: var(--r-xl);
    background: var(--tap);
    color: var(--tap-text);
    border: 1px solid var(--tap-border);
    font-size: clamp(20px, 5.5vw, 26px);
    font-weight: 550;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    transition:
      transform 0.05s ease,
      background 0.1s ease;
  }
  .tap:active {
    background: var(--tap-press);
    transform: scale(0.985);
  }
  .tap-points {
    font-size: 28px;
    font-weight: 700;
    color: var(--tap-muted);
  }
  /* Avec image, comme sur la maquette : l'image a gauche, le nom au centre,
     les points en haut a droite. */
  .tap.with-image {
    position: relative;
    padding-left: 12px;
  }
  /* Cadre fixe : une image portrait ou panoramique tient dedans, contenue. */
  .tap-image {
    flex: none;
    width: 76px;
    height: 72px;
    max-height: 100%;
    object-fit: contain;
  }
  .tap.with-image .tap-name {
    flex: 1;
    text-align: center;
  }
  .tap.with-image .tap-points {
    position: absolute;
    top: 8px;
    right: 16px;
    font-size: 24px;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
  }
  .mine {
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.1;
  }
  .mine strong {
    font-size: 20px;
  }
  .crew-note {
    text-align: center;
  }
  .empty {
    text-align: center;
    padding: 20px;
  }

  .flashes {
    position: fixed;
    inset: 0;
    pointer-events: none;
    display: grid;
    place-items: center;
  }
  .flash {
    position: absolute;
    font-size: 64px;
    font-weight: 700;
    color: var(--accent);
    animation: rise 0.7s ease-out forwards;
  }
  @keyframes rise {
    from {
      opacity: 0.9;
      transform: translateY(20px) scale(0.9);
    }
    to {
      opacity: 0;
      transform: translateY(-60px) scale(1.1);
    }
  }

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.6);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 50;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .sheet {
    position: relative;
    width: min(100%, 560px);
    max-height: 80dvh;
    display: flex;
    flex-direction: column;
    border-radius: var(--r-xl) var(--r-xl) 0 0;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  }
  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .sheet-head h2 {
    font-size: 16px;
    font-weight: 600;
  }
  .list {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .line {
    display: grid;
    grid-template-columns: 52px 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 9px 2px;
    border-bottom: 1px solid var(--line-soft);
    font-size: 14px;
  }
  .line.cancelled {
    opacity: 0.45;
    text-decoration: line-through;
  }
  .line-name {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .line-time {
    font-size: 12px;
  }
  .line-pts {
    color: var(--muted);
  }
</style>
