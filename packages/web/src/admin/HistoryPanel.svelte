<script lang="ts">
  import { EDITION_SCHEMA_VERSION, formatDuration } from '@ow/shared';
  import type { EditionSummary, EditionV1 } from '@ow/shared';
  import { api, ApiError } from '../lib/api.ts';
  import { realtime } from '../lib/realtime.svelte.ts';
  import Race from '../components/Race.svelte';

  let editions = $state<EditionSummary[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let selectedId = $state<string | null>(null);
  let edition = $state<EditionV1 | null>(null);
  let unsupported = $state(false);
  let racing = $state(false);

  $effect(() => {
    // Une edition qui se termine apparait ici sans recharger la page.
    void realtime.configVersion;
    void loadList();
  });

  async function loadList() {
    try {
      const data = await api<{ editions: EditionSummary[] }>('/api/admin/editions');
      editions = data.editions;
      error = null;
      const first = editions[0];
      if (first && !editions.some((e) => e.id === selectedId)) await open(first.id);
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Historique indisponible.';
    } finally {
      loaded = true;
    }
  }

  async function open(id: string) {
    selectedId = id;
    racing = false;
    edition = null;
    unsupported = false;
    try {
      const data = await api<{ schemaVersion: number; edition: EditionV1 }>(`/api/admin/editions/${id}`);
      // Une edition enregistree par une version plus recente de l'app : on ne
      // pretend pas savoir la lire.
      if (data.schemaVersion > EDITION_SCHEMA_VERSION) {
        unsupported = true;
        return;
      }
      edition = data.edition;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Édition illisible.';
    }
  }

  const date = (ms: number) =>
    new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  /** Meilleur temps sur chaque epreuve, mis en evidence. */
  const bestSplits = $derived(
    (edition?.exercises ?? []).map((_, i) => {
      const values = (edition?.teams ?? [])
        .map((t) => t.result.splits[i])
        .filter((v): v is number => typeof v === 'number');
      return values.length ? Math.min(...values) : null;
    }),
  );
</script>

<div class="head">
  <h2>Historique</h2>
  <p class="muted tiny">Les éditions terminées, figées telles qu'elles se sont déroulées.</p>
</div>

{#if error}
  <p class="err">{error}</p>
{/if}

{#if loaded && editions.length === 0}
  <p class="muted empty">
    Aucune édition terminée pour l'instant. Une édition entre ici quand on clique sur « Terminer ».
  </p>
{:else}
  <div class="layout">
    <aside class="list">
      {#each editions as item (item.id)}
        <button class="item card" class:on={item.id === selectedId} onclick={() => open(item.id)}>
          <strong>{item.name}</strong>
          <span class="tiny muted">{date(item.endedAt)} · {item.finished}/{item.teams} arrivées</span>
          {#if item.winner}
            <span class="tiny winner">🏆 {item.winner} · {formatDuration(item.winnerMs)}</span>
          {/if}
        </button>
      {/each}
    </aside>

    <section class="detail">
      {#if unsupported}
        <p class="muted empty">
          Cette édition a été enregistrée par une version plus récente de l'application.
        </p>
      {:else if edition}
        <header>
          <div>
            <h3>{edition.name}</h3>
            <p class="tiny muted">
              {date(edition.startedAt)} · {edition.teams.length} équipes ·
              {edition.exercises.map((e) => e.name).join(' → ')}
            </p>
          </div>
          <span class="spacer"></span>
          <button
            class="btn primary sm"
            onclick={() => (racing = !racing)}
            disabled={!edition.teams.some((t) => t.result.started)}
          >
            {racing ? 'Fermer la course' : 'Rejouer la course (30 s)'}
          </button>
        </header>

        {#if racing}
          {#key selectedId}
            <Race {edition} />
          {/key}
        {/if}

        <div class="card board">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Équipe</th>
                  <th>Série</th>
                  {#each edition.exercises as exercise (exercise.id)}
                    <th class="num-col">{exercise.name}</th>
                  {/each}
                  <th class="num-col">Total</th>
                </tr>
              </thead>
              <tbody>
                {#each edition.teams as team (team.id)}
                  <tr>
                    <td class="rank num">{team.result.rank ?? '—'}</td>
                    <td>{team.name}</td>
                    <td class="muted">{team.heatName ?? '—'}</td>
                    {#each team.result.splits as split, s}
                      <td class="num num-col" class:best={split !== null && split === bestSplits[s]}>
                        {formatDuration(split)}
                      </td>
                    {/each}
                    <td class="num num-col total" class:partial={!team.result.finished}>
                      {#if team.result.finished}
                        {formatDuration(team.result.elapsedMs)}
                      {:else if team.result.started}
                        arrêt : {edition.exercises[team.result.currentIndex]?.name ?? ''}
                      {:else}
                        non partie
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    </section>
  </div>
{/if}

<style>
  .head {
    margin-bottom: 14px;
  }
  h2 {
    font-size: 18px;
    font-weight: 600;
  }
  .err {
    color: var(--danger);
    margin-bottom: 10px;
  }
  .empty {
    padding: 24px 0;
  }
  .layout {
    display: grid;
    grid-template-columns: 250px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 820px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    padding: 10px 12px;
    text-align: left;
    color: var(--text);
    cursor: pointer;
  }
  .item.on {
    border-color: var(--accent);
  }
  .winner {
    color: var(--muted);
  }
  .detail {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .detail header {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  h3 {
    font-size: 17px;
    font-weight: 600;
  }
  .board {
    padding: 10px 14px;
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
</style>
