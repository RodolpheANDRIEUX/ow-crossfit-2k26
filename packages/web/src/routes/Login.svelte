<script lang="ts">
  import { api, ApiError } from '../lib/api.ts';
  import Logo from '../components/Logo.svelte';
  import { session } from '../lib/session.svelte.ts';

  interface Roster {
    event: { name: string };
    teams: { id: string; name: string; members: { id: string; name: string }[] }[];
  }

  let roster = $state<Roster | null>(null);
  let loadError = $state<string | null>(null);
  let mode = $state<'judge' | 'admin'>('judge');
  let memberId = $state<string | null>(null);
  let code = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const selected = $derived(
    roster?.teams.flatMap((t) => t.members).find((m) => m.id === memberId) ?? null,
  );

  $effect(() => {
    api<Roster>('/api/roster')
      .then((data) => (roster = data))
      .catch(() => (loadError = 'Serveur injoignable — vérifie le réseau.'));
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      if (mode === 'admin') await session.loginAdmin(code);
      else if (memberId) await session.loginJudge(memberId, code);
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Connexion impossible';
      code = '';
    } finally {
      busy = false;
    }
  }
</script>

<main class="canvas">
  <div class="sheet">
    <header>
      <div class="mark"><Logo size={56} /></div>
      <h1>{roster?.event.name ?? 'Compteur'}</h1>
      <p class="muted">Comptage des répétitions par équipes</p>
    </header>

    {#if loadError}
      <p class="error">{loadError}</p>
    {/if}

    <div class="switch" role="tablist">
      <button
        class="btn ghost"
        class:on={mode === 'judge'}
        role="tab"
        aria-selected={mode === 'judge'}
        onclick={() => ((mode = 'judge'), (error = null))}>Participant</button
      >
      <button
        class="btn ghost"
        class:on={mode === 'admin'}
        role="tab"
        aria-selected={mode === 'admin'}
        onclick={() => ((mode = 'admin'), (error = null))}>Organisation</button
      >
    </div>

    <form onsubmit={submit}>
      {#if mode === 'judge'}
        {#if roster && roster.teams.length > 0}
          <label class="label" for="who">Qui es-tu ?</label>
          <select id="who" class="input" bind:value={memberId}>
            <option value={null} disabled selected>Choisis ton nom</option>
            {#each roster.teams as team (team.id)}
              <optgroup label={team.name}>
                {#each team.members as member (member.id)}
                  <option value={member.id}>{member.name}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        {:else if roster}
          <p class="muted">Aucun participant enregistré pour l'instant.</p>
        {/if}
      {/if}

      <label class="label" for="code">
        {mode === 'admin' ? "Code d'accès organisation" : 'Ton code'}
      </label>
      <input
        id="code"
        class="input code"
        bind:value={code}
        autocomplete="one-time-code"
        autocapitalize="characters"
        spellcheck="false"
        placeholder={mode === 'admin' ? '••••••' : '••••'}
      />

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <button
        class="btn primary big"
        type="submit"
        disabled={busy || code.length === 0 || (mode === 'judge' && !memberId)}
      >
        {busy ? 'Connexion…' : selected && mode === 'judge' ? `Entrer — ${selected.name}` : 'Entrer'}
      </button>
    </form>

    <p class="tiny muted foot">
      Ton écran s'ouvre directement sur ton affectation du moment. Rien à chercher.
    </p>
  </div>
</main>

<style>
  main {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 24px 18px calc(24px + env(safe-area-inset-bottom));
  }
  .sheet {
    width: min(100%, 420px);
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  header {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
  }
  .mark {
    margin-bottom: 6px;
  }
  h1 {
    font-size: 26px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  .switch {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--line-soft);
    border-radius: var(--r-md);
  }
  .switch .on {
    background: var(--surface-3);
    color: var(--text);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  form .label:not(:first-child) {
    margin-top: 12px;
  }
  .code {
    text-align: center;
    font-size: 30px;
    letter-spacing: 0.35em;
    text-indent: 0.35em;
    padding: 14px;
    min-height: 62px;
    text-transform: uppercase;
  }
  .big {
    margin-top: 16px;
    min-height: 54px;
    font-size: 17px;
    border-radius: var(--r-lg);
  }
  .error {
    color: var(--danger);
    font-size: 14px;
    margin-top: 8px;
  }
  .foot {
    text-align: center;
  }
</style>
