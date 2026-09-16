<script lang="ts">
  import { onMount } from 'svelte';
  import { formatChrono, formatDuration, positionAt } from '@ow/shared';
  import type { EditionV1 } from '@ow/shared';

  let { edition }: { edition: EditionV1 } = $props();

  /** Duree de la rediffusion, quelle que soit la duree reelle du workout. */
  const REPLAY_MS = 30_000;

  // Couloirs dans l'ordre de la configuration, pas du classement : on ne
  // devoile pas le resultat avant la ligne d'arrivee.
  const runners = $derived(
    edition.teams.filter((t) => t.result.started).sort((a, b) => a.position - b.position),
  );

  // Chaque equipe court sur son propre chrono : des series differentes
  // partent ensemble.
  const horizon = $derived(
    Math.max(
      1,
      ...runners.map((t) =>
        t.result.finished && t.result.elapsedMs !== null
          ? t.result.elapsedMs
          : (t.track[t.track.length - 1]?.[0] ?? 0),
      ),
    ),
  );
  const speed = $derived(Math.max(1, Math.round(horizon / REPLAY_MS)));

  let raceMs = $state(0);
  let playing = $state(false);
  let frame = 0;
  let anchorClock = 0;
  let anchorRace = 0;

  function tick(now: number) {
    raceMs = Math.min(horizon, anchorRace + ((now - anchorClock) * horizon) / REPLAY_MS);
    if (raceMs >= horizon) {
      playing = false;
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function play() {
    if (raceMs >= horizon) raceMs = 0;
    anchorClock = performance.now();
    anchorRace = raceMs;
    playing = true;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
  }

  function pause() {
    cancelAnimationFrame(frame);
    playing = false;
  }

  function restart() {
    pause();
    raceMs = 0;
    play();
  }

  onMount(() => {
    play();
    return () => cancelAnimationFrame(frame);
  });

  // Chaque input est rejoue a son instant : une rep fait avancer, une
  // annulation fait reculer.
  const lanes = $derived(
    runners.map((team) => {
      const arrived =
        team.result.finished && team.result.elapsedMs !== null && raceMs >= team.result.elapsedMs;
      const at = positionAt(team.track, raceMs);
      return { team, arrived, progress: arrived ? 1 : at.progress, exerciseIndex: at.exerciseIndex };
    }),
  );

  /** Classement a l'instant affiche : arrivees dans l'ordre, puis la course. */
  const ranks = $derived.by(() => {
    const order = [...lanes].sort((a, b) => {
      if (a.arrived && b.arrived) return (a.team.result.elapsedMs ?? 0) - (b.team.result.elapsedMs ?? 0);
      if (a.arrived !== b.arrived) return a.arrived ? -1 : 1;
      return b.progress - a.progress;
    });
    return new Map(order.map((lane, index) => [lane.team.id, index + 1]));
  });
</script>

<section class="race card">
  <header>
    <span class="clock num">{formatChrono(raceMs)}</span>
    <span class="tiny muted">×{speed}</span>
    <span class="spacer"></span>
    <button class="btn sm" onclick={() => (playing ? pause() : play())}>
      {playing ? 'Pause' : raceMs >= horizon ? 'Revoir' : 'Lecture'}
    </button>
    <button class="btn ghost sm" onclick={restart}>Recommencer</button>
  </header>

  <div class="scrub" aria-hidden="true">
    <span style="width:{(raceMs / horizon) * 100}%"></span>
  </div>

  <div class="lanes">
    {#each lanes as lane (lane.team.id)}
      <div class="lane" class:arrived={lane.arrived}>
        <span class="rank num">{ranks.get(lane.team.id)}</span>
        <div class="who">
          <strong>{lane.team.name}</strong>
          <span class="tiny muted">
            {#if lane.arrived}
              {formatDuration(lane.team.result.elapsedMs)}
            {:else}
              {edition.exercises[lane.exerciseIndex]?.name ?? ''}
            {/if}
            {#if lane.team.heatName}· {lane.team.heatName}{/if}
          </span>
        </div>
        <div class="track">
          {#each edition.exercises.slice(1) as exercise, i (exercise.id)}
            <span class="gate" style="left:{((i + 1) / edition.exercises.length) * 100}%"></span>
          {/each}
          <span class="runner" style="left:{lane.progress * 100}%"></span>
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .race {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .clock {
    font-size: 26px;
    font-weight: 650;
  }
  .scrub {
    height: 3px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .scrub span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .lanes {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .lane {
    display: grid;
    grid-template-columns: 24px minmax(110px, 190px) minmax(0, 1fr);
    align-items: center;
    gap: 12px;
  }
  .rank {
    text-align: center;
    font-weight: 700;
    color: var(--muted);
  }
  .lane.arrived .rank {
    color: var(--accent);
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.25;
  }
  .who strong {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track {
    position: relative;
    height: 14px;
    margin-right: 10px;
    border-radius: 999px;
    background: var(--surface-2);
    border-right: 3px solid var(--accent);
  }
  .gate {
    position: absolute;
    top: 2px;
    bottom: 2px;
    width: 1px;
    background: var(--line);
  }
  .runner {
    position: absolute;
    top: 50%;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--text);
    border: 3px solid var(--surface);
    box-shadow: var(--shadow);
    transform: translate(-50%, -50%);
    transition: left 0.12s linear;
  }
  .lane.arrived .runner {
    background: var(--accent);
  }
</style>
