<script lang="ts">
  import type { Assignment, Heat } from '@ow/shared';
  import { admin } from '../lib/adminState.svelte.ts';
  import { toast } from '../lib/toast.svelte.ts';

  const teams = $derived(admin.data?.teams ?? []);
  const exercises = $derived(admin.data?.exercises ?? []);

  let groupSize = $state(3);
  let selected = $state<Assignment | null>(null);

  const heats = $derived([...(admin.data?.heats ?? [])].sort((a, b) => a.position - b.position));
  const scheduled = $derived(new Set(heats.flatMap((h) => h.teamIds)));
  const unscheduled = $derived(teams.filter((t) => !scheduled.has(t.id)).length);

  async function draw() {
    const result = await admin.mutate<{ warnings: string[]; heats: number }>(
      '/api/admin/heats/draw',
      { body: { groupSize }, success: 'Tirage effectué' },
    );
    if (result?.warnings.length) toast.show(result.warnings[0] ?? '', 6000);
  }

  /**
   * Echange de deux arbitres. Dans une meme serie le serveur fait la
   * permutation d'un bloc ; entre deux series, deux remplacements suffisent.
   */
  async function swapWith(target: Assignment) {
    const source = selected;
    selected = null;
    if (!source || source.id === target.id) return;
    if (source.heatId === target.heatId) {
      await admin.mutate('/api/admin/assignments/swap', {
        body: { a: source.id, b: target.id },
        success: 'Arbitres échangés',
      });
    } else {
      const sourceJudge = source.judgeMemberId;
      await admin.mutate(`/api/admin/assignments/${source.id}`, {
        method: 'PATCH',
        body: { judgeMemberId: target.judgeMemberId },
      });
      await admin.mutate(`/api/admin/assignments/${target.id}`, {
        method: 'PATCH',
        body: { judgeMemberId: sourceJudge },
        success: 'Arbitres échangés',
      });
    }
  }

  const replace = (assignment: Assignment, judgeMemberId: string) =>
    admin.mutate(`/api/admin/assignments/${assignment.id}`, {
      method: 'PATCH',
      body: { judgeMemberId },
    });

  async function removeHeat(heat: Heat) {
    if (!confirm('Supprimer cette série et ses affectations ?')) return;
    await admin.mutate(`/api/admin/heats/${heat.id}`, { method: 'DELETE' });
  }

  /** Personnes disponibles pour arbitrer une serie : hors equipes qui passent. */
  function eligible(heat: Heat) {
    const busy = new Set(heat.assignments.map((a) => a.judgeMemberId));
    return teams
      .filter((t) => !heat.teamIds.includes(t.id))
      .flatMap((t) =>
        t.members.map((m) => ({
          id: m.id,
          label: `${m.name} — ${t.name}${m.canJudgeForm ? ' (forme)' : ''}`,
          busy: busy.has(m.id),
        })),
      );
  }

  /** Les trois postes d'une equipe, dans l'ordre de lecture. */
  const POSTS = [
    { role: 'counter', label: 'Compteur' },
    { role: 'timer', label: 'Chrono' },
    { role: 'form', label: 'Forme' },
  ] as const;

  function posts(heat: Heat, teamId: string) {
    return POSTS.map((post) => ({
      ...post,
      assignment:
        heat.assignments.find((a) => a.teamId === teamId && a.role === post.role) ?? null,
    }));
  }
</script>

<div class="head">
  <div>
    <h2>Déroulement</h2>
    <p class="muted tiny">
      Chaque série enchaîne le workout complet :
      {exercises.map((e) => e.name).join(' → ') || 'aucune épreuve'}. Tire au sort sur place,
      ajustable à tout moment. Les séries se lancent depuis l'onglet Live, pendant l'événement.
    </p>
  </div>
</div>

<div class="toolbar card">
  <span class="muted tiny">Équipes en simultané</span>
  <input class="input num-input" type="number" min="1" max="20" bind:value={groupSize} />
  <button class="btn primary" onclick={draw} disabled={teams.length === 0}>
    Tirer au sort le déroulement
  </button>
  <span class="spacer"></span>
  {#if unscheduled > 0 && heats.length > 0}
    <span class="pill warn">{unscheduled} équipe(s) non programmée(s)</span>
  {/if}
</div>

{#if selected}
  <p class="hint">
    Sélection : <strong>{admin.memberById(selected.judgeMemberId)?.name}</strong> — choisis un
    autre arbitre pour les échanger.
    <button class="btn ghost sm" onclick={() => (selected = null)}>Annuler</button>
  </p>
{/if}

<div class="heats">
  {#each heats as heat (heat.id)}
    <section class="card heat" class:active={heat.status === 'active'}>
      <header>
        <strong>{heat.name}</strong>
        <span class="pill" class:ok={heat.status === 'active'}>
          {heat.status === 'active' ? 'En cours' : heat.status === 'done' ? 'Terminée' : 'En attente'}
        </span>
        <span class="spacer"></span>
        <!-- Lancer une serie se fait depuis l'onglet Live : c'est l'ecran ouvert
             pendant l'evenement. Ici, on prepare et on ajuste. -->
        <button class="btn ghost sm" onclick={() => removeHeat(heat)} title="Supprimer la série">✕</button>
      </header>

      <div class="teams">
        {#each heat.teamIds as teamId (teamId)}
          {@const team = admin.teamById(teamId)}
          <div class="team">
            <div class="team-name">{team?.name ?? '—'}</div>
            <div class="slots">
              {#each posts(heat, teamId) as post (post.role)}
                <div class="slot">
                  <span class="who">{post.label}</span>
                  {#if post.assignment}
                    {@const judge = admin.memberById(post.assignment.judgeMemberId)}
                    <select
                      class="picker"
                      class:missing={post.role === 'form' && !judge?.canJudgeForm}
                      value={post.assignment.judgeMemberId}
                      onchange={(e) => replace(post.assignment!, e.currentTarget.value)}
                    >
                      {#each eligible(heat) as person (person.id)}
                        <option
                          value={person.id}
                          disabled={person.busy && person.id !== post.assignment.judgeMemberId}
                        >
                          {person.label}
                        </option>
                      {/each}
                    </select>
                    <button
                      class="swap"
                      class:sel={selected?.id === post.assignment.id}
                      title="Échanger avec un autre arbitre"
                      onclick={() =>
                        selected ? swapWith(post.assignment!) : (selected = post.assignment)}
                      >⇄</button
                    >
                  {:else}
                    <span class="pill warn">à pourvoir</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {:else}
    <p class="muted empty">
      Aucune série pour l'instant. Lance le tirage au sort quand tout le monde est prêt.
    </p>
  {/each}
</div>

<style>
  .head h2 {
    font-size: 18px;
    font-weight: 600;
  }
  .head {
    margin-bottom: 14px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    flex-wrap: wrap;
  }
  .num-input {
    width: 70px;
    text-align: center;
    min-height: 34px;
    padding: 4px;
  }
  .hint {
    margin: 12px 0;
    font-size: 14px;
    color: var(--muted);
  }
  .heats {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-top: 14px;
  }
  .heat {
    padding: 12px;
  }
  .heat.active {
    border-color: rgb(34 197 94 / 0.35);
  }
  .heat header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .teams {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 10px;
  }
  .team {
    background: var(--surface-2);
    border-radius: var(--r-md);
    padding: 10px;
  }
  .team-name {
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 8px;
  }
  .slots {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .slot {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto;
    align-items: center;
    gap: 6px;
  }
  .who {
    font-size: 13px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Remplacer un arbitre = un menu. L'echanger avec un autre = le bouton ⇄. */
  .picker {
    width: 100%;
    min-width: 0;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 5px 6px;
    font-size: 13px;
    cursor: pointer;
  }
  /* Poste « forme » confie a quelqu'un qui n'est pas habilite : ca se voit. */
  .picker.missing {
    border-color: rgb(240 160 32 / 0.55);
    color: var(--warn);
  }
  .swap {
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    color: var(--muted);
    padding: 4px 7px;
    cursor: pointer;
    font-size: 14px;
  }
  .swap:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .swap.sel {
    color: var(--accent);
    border-color: var(--accent);
  }
  .empty {
    padding: 30px 0;
    text-align: center;
  }
</style>
