<script lang="ts">
  import { admin } from '../lib/adminState.svelte.ts';

  let { locked }: { locked: boolean } = $props();

  const teams = $derived(admin.data?.teams ?? []);
  const teamSize = $derived(admin.data?.event.teamSize ?? 3);
  let newTeam = $state('');
  let drafts = $state<Record<string, string>>({});
  let showCodes = $state(false);

  async function addTeam() {
    const name = newTeam.trim();
    if (!name) return;
    newTeam = '';
    await admin.mutate('/api/admin/teams', { body: { name } });
  }

  async function addMember(teamId: string) {
    const name = (drafts[teamId] ?? '').trim();
    if (!name) return;
    drafts[teamId] = '';
    await admin.mutate(`/api/admin/teams/${teamId}/members`, { body: { name } });
  }

  const rename = (id: string, name: string) =>
    admin.mutate(`/api/admin/teams/${id}`, { method: 'PATCH', body: { name } });

  const renameMember = (id: string, name: string) =>
    admin.mutate(`/api/admin/members/${id}`, { method: 'PATCH', body: { name } });

  const toggleForm = (id: string, canJudgeForm: boolean) =>
    admin.mutate(`/api/admin/members/${id}`, { method: 'PATCH', body: { canJudgeForm } });

  const newCode = (id: string) =>
    admin.mutate(`/api/admin/members/${id}`, {
      method: 'PATCH',
      body: { regenerateCode: true },
      success: 'Nouveau code généré',
    });

  async function removeTeam(id: string, name: string) {
    if (!confirm(`Supprimer l'équipe « ${name} » et ses membres ?`)) return;
    await admin.mutate(`/api/admin/teams/${id}`, { method: 'DELETE' });
  }

  async function removeMember(id: string, name: string) {
    if (!confirm(`Retirer ${name} ?`)) return;
    await admin.mutate(`/api/admin/members/${id}`, { method: 'DELETE' });
  }

  const seedDemo = () =>
    admin.mutate('/api/admin/demo', { success: 'Jeu de démonstration créé' });
</script>

<div class="head">
  <div>
    <h2>Équipes</h2>
    <p class="muted tiny">
      {teams.length} équipe(s) · {teamSize} participants par équipe · le code sert à se connecter
    </p>
  </div>
  <span class="spacer"></span>
  <label class="row tiny muted">
    <input type="checkbox" bind:checked={showCodes} /> Afficher les codes
  </label>
  {#if teams.length === 0 && !locked}
    <button class="btn sm" onclick={seedDemo}>Jeu de démonstration</button>
  {/if}
</div>

<div class="grid">
  {#each teams as team (team.id)}
    <section class="card team">
      <header>
        <input
          class="input inline name"
          value={team.name}
          disabled={locked}
          onchange={(e) => rename(team.id, e.currentTarget.value)}
        />
        {#if !locked}
          <button
            class="btn ghost sm"
            title="Supprimer l'équipe"
            onclick={() => removeTeam(team.id, team.name)}>✕</button
          >
        {/if}
      </header>

      <ul>
        {#each team.members as member (member.id)}
          <li>
            <input
              class="input inline"
              value={member.name}
              disabled={locked}
              onchange={(e) => renameMember(member.id, e.currentTarget.value)}
            />
            <button
              class="pill"
              class:ok={member.canJudgeForm}
              title="Habilité à juger la forme des mouvements"
              disabled={locked}
              onclick={() => toggleForm(member.id, !member.canJudgeForm)}
            >
              forme
            </button>
            {#if showCodes}
              <button class="code" title="Régénérer le code" onclick={() => newCode(member.id)}>
                {member.code}
              </button>
            {/if}
            {#if !locked}
              <button class="btn ghost sm" onclick={() => removeMember(member.id, member.name)}
                >✕</button
              >
            {/if}
          </li>
        {/each}
      </ul>

      {#if team.members.length !== teamSize}
        <p class="tiny warn-text">{team.members.length}/{teamSize} participants</p>
      {/if}

      {#if !locked}
        <form
          class="add"
          onsubmit={(e) => {
            e.preventDefault();
            addMember(team.id);
          }}
        >
          <input
            class="input"
            placeholder="Ajouter un participant"
            bind:value={drafts[team.id]}
          />
        </form>
      {/if}
    </section>
  {/each}

  {#if !locked}
    <form
      class="card new"
      onsubmit={(e) => {
        e.preventDefault();
        addTeam();
      }}
    >
      <input class="input" placeholder="Nom de la nouvelle équipe" bind:value={newTeam} />
      <button class="btn" type="submit" disabled={!newTeam.trim()}>Ajouter l'équipe</button>
    </form>
  {/if}
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  h2 {
    font-size: 18px;
    font-weight: 600;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
    gap: 14px;
    align-items: start;
  }
  .team {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .team header {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .name {
    font-weight: 600;
    font-size: 15px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  li .input {
    flex: 1;
    min-width: 0;
  }
  .pill {
    cursor: pointer;
    opacity: 0.5;
  }
  .pill.ok {
    opacity: 1;
  }
  .pill:disabled {
    cursor: default;
  }
  .code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    letter-spacing: 0.12em;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 3px 8px;
    cursor: pointer;
    color: var(--text);
  }
  .add {
    margin-top: 2px;
  }
  .new {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-style: dashed;
  }
  .warn-text {
    color: var(--warn);
  }
</style>
