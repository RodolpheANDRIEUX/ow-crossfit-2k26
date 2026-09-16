<script lang="ts">
  import type { Heat } from '@ow/shared';
  import { formatDuration } from '@ow/shared';
  import { admin } from '../lib/adminState.svelte.ts';
  import Chrono from '../components/Chrono.svelte';

  const teams = $derived(admin.data?.teams ?? []);
  const exercises = $derived(admin.data?.exercises ?? []);
  const heats = $derived([...(admin.data?.heats ?? [])].sort((a, b) => a.position - b.position));
  const activeHeats = $derived(heats.filter((h) => h.status === 'active'));
  const launched = $derived(admin.data?.event.runningSince != null);

  /**
   * Classement : temps total du workout, le plus faible gagne.
   * Les equipes en cours suivent, rangees par avancement.
   */
  const ranking = $derived.by(() =>
    teams
      .map((team) => {
        const snapshot = admin.snapshotFor(team.id);
        const state = snapshot?.state ?? null;
        const index = state?.currentIndex ?? 0;
        return {
          team,
          finished: state?.finished ?? false,
          elapsed: state?.elapsedMs ?? null,
          index,
          score: state?.exercises[index]?.score ?? 0,
          started: (snapshot?.run.segments.length ?? 0) > 0,
          splits: exercises.map(
            (exercise) => state?.exercises.find((p) => p.exerciseId === exercise.id)?.splitMs ?? null,
          ),
        };
      })
      .sort((a, b) => {
        if (a.finished && b.finished) return (a.elapsed ?? 0) - (b.elapsed ?? 0);
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        return b.index - a.index || b.score - a.score;
      }),
  );

  /** Meilleur temps sur chaque epreuve, mis en evidence dans le tableau. */
  const bestSplits = $derived(
    exercises.map((_, i) => {
      const values = ranking.map((r) => r.splits[i]).filter((v): v is number => v !== null && v !== undefined);
      return values.length ? Math.min(...values) : null;
    }),
  );

  /**
   * Lancer ou clore une serie. C'est ici que ca se passe : le jour J, l'ecran
   * ouvert est celui-ci, pas l'onglet du tirage au sort.
   */
  const setStatus = (heat: Heat, status: 'pending' | 'active' | 'done') =>
    admin.mutate(`/api/admin/heats/${heat.id}`, {
      method: 'PATCH',
      body: { status },
      success:
        status === 'active' ? 'Série lancée — les arbitres voient leur écran' : 'Série clôturée',
    });

  async function reset(runId: string, teamName: string) {
    if (!confirm(`Effacer tout le comptage et le chrono du workout de ${teamName} ?`)) return;
    await admin.mutate(`/api/admin/runs/${runId}/reset`, { success: 'Passage remis à zéro' });
  }
</script>

{#if !launched}
  <p class="muted empty">
    L'édition n'est pas lancée : les participants voient le catalogue des épreuves. Le bouton
    « Lancer » publie les affectations et démarre le comptage.
  </p>
{:else if heats.length === 0}
  <p class="muted empty">
    Aucune série programmée. Fais le tirage au sort dans l'onglet Déroulement.
  </p>
{:else}
  <section class="heats card">
    {#each heats as heat (heat.id)}
      <div class="heat-row">
        <strong>{heat.name}</strong>
        <span class="tiny muted names">
          {heat.teamIds.map((id) => admin.teamById(id)?.name ?? '—').join(' · ')}
        </span>
        <span class="spacer"></span>
        <span class="pill" class:ok={heat.status === 'active'}>
          {heat.status === 'active' ? 'En cours' : heat.status === 'done' ? 'Terminée' : 'En attente'}
        </span>
        {#if heat.status === 'active'}
          <button class="btn sm" onclick={() => setStatus(heat, 'done')}>Clôturer</button>
        {:else}
          <button class="btn sm primary" onclick={() => setStatus(heat, 'active')}>Lancer</button>
        {/if}
      </div>
    {/each}
  </section>
  {#if activeHeats.length === 0}
    <p class="muted empty">
      Aucune série en cours. Lance une série ci-dessus : les arbitres verront leur écran apparaître.
    </p>
  {/if}
{/if}

{#each activeHeats as heat (heat.id)}
  <section class="live">
    <h2>{heat.name}</h2>
    <div class="runs">
      {#each heat.teamIds as teamId (teamId)}
        {@const team = admin.teamById(teamId)}
        {@const snapshot = admin.snapshotFor(teamId)}
        {#if team && snapshot}
          {@const running = snapshot.run.status === 'running'}
          {@const finished = snapshot.state.finished}
          {@const index = snapshot.state.currentIndex}
          {@const exercise = exercises[index]}
          {@const progress = snapshot.state.exercises[index]}
          <article class="card run" class:finished>
            <header>
              <strong>{team.name}</strong>
              <span class="spacer"></span>
              {#if finished}
                <span class="pill ok">Terminé</span>
              {:else if progress?.pointsReached}
                <span class="pill warn">Minimums à valider</span>
              {:else if snapshot.run.status === 'paused'}
                <span class="pill">En pause</span>
              {/if}
            </header>

            <div class="figures">
              <div class="progress">
                <span class="tiny muted">
                  {finished ? 'Temps total' : exercise ? `${index + 1}/${exercises.length} · ${exercise.name}` : ''}
                </span>
                {#if !finished && progress}
                  <span class="score num">
                    {progress.score}<span class="sep">/{progress.targetPoints}</span>
                  </span>
                {/if}
              </div>
              <div class="time num" class:done={finished}>
                <Chrono
                  segments={snapshot.run.segments}
                  frozenMs={finished ? snapshot.state.elapsedMs : null}
                  {running}
                />
              </div>
            </div>

            {#if !finished && progress}
              <div class="bar" aria-hidden="true">
                <span style="width:{Math.min(100, (progress.score / progress.targetPoints) * 100)}%"
                ></span>
              </div>
              <!-- Minimums de l'epreuve en cours, valides par l'arbitre au chrono. -->
              <ul class="members">
                {#each progress.minimums as minimum (minimum.memberId)}
                  {@const member = team.members.find((m) => m.id === minimum.memberId)}
                  <li class:ok={minimum.validated}>
                    <span class="mark">{minimum.validated ? '✓' : '○'}</span>
                    <span class="muted">{member?.name ?? '—'}</span>
                  </li>
                {/each}
              </ul>
            {/if}

            <!-- Fil du workout avec les temps intermediaires. -->
            <ol class="steps">
              {#each exercises as step, i (step.id)}
                {@const p = snapshot.state.exercises[i]}
                <li class:done={p?.completedAt != null} class:current={i === index && !finished}>
                  <span>{step.name}</span>
                  <span class="num">{p?.splitMs != null ? formatDuration(p.splitMs) : ''}</span>
                </li>
              {/each}
            </ol>

            <!-- Le chrono appartient a l'arbitre au chrono : l'organisation ne
                 le pilote pas d'ici. Seule la remise a zero reste possible, en
                 cas de faux depart. -->
            <footer>
              <button class="btn sm danger" onclick={() => reset(snapshot.run.id, team.name)}>
                Remettre à zéro
              </button>
            </footer>
          </article>
        {/if}
      {/each}
    </div>
  </section>
{/each}

<section class="board card">
  <header>
    <h3>Classement</h3>
    <span class="tiny muted">Temps total du workout · temps par épreuve</span>
  </header>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th></th>
          <th>Équipe</th>
          {#each exercises as exercise (exercise.id)}
            <th class="num-col">{exercise.name}</th>
          {/each}
          <th class="num-col">Total</th>
        </tr>
      </thead>
      <tbody>
        {#each ranking as row, i (row.team.id)}
          <tr>
            <td class="rank num">{row.finished ? i + 1 : '—'}</td>
            <td>{row.team.name}</td>
            {#each row.splits as split, s}
              <td class="num num-col" class:best={split !== null && split === bestSplits[s]}>
                {formatDuration(split)}
              </td>
            {/each}
            <td class="num num-col total" class:partial={!row.finished}>
              {#if row.finished}
                {formatDuration(row.elapsed)}
              {:else if row.started}
                {exercises[row.index]?.name ?? ''}
              {:else}
                —
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  /* Les series se pilotent ici, sans changer d'onglet. */
  .heats {
    padding: 4px 12px;
    margin-bottom: 18px;
    display: flex;
    flex-direction: column;
  }
  .heat-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 0;
    border-top: 1px solid var(--line-soft);
    flex-wrap: wrap;
  }
  .heat-row:first-child {
    border-top: none;
  }
  .names {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .live {
    margin-bottom: 22px;
  }
  h2 {
    font-size: 15px;
    font-weight: 600;
    color: var(--muted);
    margin-bottom: 10px;
  }
  .runs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
    gap: 12px;
  }
  .run {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .run.finished {
    border-color: rgb(34 197 94 / 0.3);
  }
  .run header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .figures {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 10px;
  }
  .progress {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .score {
    font-size: 30px;
    font-weight: 650;
    line-height: 1;
  }
  .sep {
    font-size: 16px;
    color: var(--muted-2);
    font-weight: 400;
  }
  .time {
    font-size: 22px;
    color: var(--text);
  }
  .time.done {
    color: var(--accent);
  }
  .bar {
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
  .members {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 8px;
    font-size: 13px;
  }
  .members li {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    min-width: 0;
  }
  .members li span:last-child {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .members .mark {
    color: var(--muted-2);
  }
  .members li.ok span {
    color: var(--accent);
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
  }
  .steps li {
    display: flex;
    justify-content: space-between;
    padding: 3px 8px;
    border-radius: var(--r-sm);
    color: var(--muted-2);
  }
  .steps li.done {
    color: var(--muted);
  }
  .steps li.done .num {
    color: var(--accent);
  }
  .steps li.current {
    background: var(--surface-2);
    color: var(--text);
    font-weight: 600;
  }
  .run footer {
    display: flex;
    gap: 8px;
  }

  .board {
    padding: 12px 14px;
  }
  .board header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 8px;
  }
  h3 {
    font-size: 15px;
    font-weight: 600;
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th {
    text-align: left;
    font-weight: 500;
    font-size: 12px;
    color: var(--muted);
    padding: 6px 4px;
    white-space: nowrap;
  }
  td {
    padding: 7px 4px;
    border-top: 1px solid var(--line-soft);
    white-space: nowrap;
  }
  .num-col {
    text-align: right;
  }
  .rank {
    width: 28px;
    color: var(--muted);
  }
  td.best {
    color: var(--accent);
    font-weight: 600;
  }
  .total {
    font-weight: 600;
  }
  .total.partial {
    color: var(--muted);
    font-weight: 400;
  }
  .empty {
    padding: 24px 0;
  }
</style>
