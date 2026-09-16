<script lang="ts">
  import { admin } from '../lib/adminState.svelte.ts';
  import { realtime } from '../lib/realtime.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { toast } from '../lib/toast.svelte.ts';
  import LinkBadge from '../components/LinkBadge.svelte';
  import Logo from '../components/Logo.svelte';
  import TeamsPanel from '../admin/TeamsPanel.svelte';
  import ExercisesPanel from '../admin/ExercisesPanel.svelte';
  import HeatsPanel from '../admin/HeatsPanel.svelte';
  import LivePanel from '../admin/LivePanel.svelte';
  import HistoryPanel from '../admin/HistoryPanel.svelte';

  type Tab = 'exercises' | 'teams' | 'heats' | 'live' | 'history';
  let tab = $state<Tab>('exercises');
  let editingName = $state(false);
  let nameDraft = $state('');
  let busy = $state(false);

  const event = $derived(admin.data?.event ?? null);
  // Une edition en cours = configuration verrouillee et affectations publiees.
  const running = $derived(event?.runningSince != null);
  const since = $derived(
    event?.runningSince
      ? new Date(event.runningSince).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : '',
  );

  $effect(() => {
    void realtime.configVersion;
    void admin.load();
  });

  // Dans l'ordre ou l'organisation s'en sert : preparer, faire tourner, revoir.
  const tabs: { id: Tab; label: string }[] = [
    { id: 'exercises', label: 'Épreuves' },
    { id: 'teams', label: 'Équipes' },
    { id: 'heats', label: 'Déroulement' },
    { id: 'live', label: 'Live' },
    { id: 'history', label: 'Historique' },
  ];

  async function launch() {
    if (!event || busy) return;
    const confirmed = confirm(
      `Lancer l'édition « ${event.name} » ?\n\nLa configuration sera verrouillée et les arbitres verront leurs affectations.`,
    );
    if (!confirmed) return;
    busy = true;
    const result = await admin.mutate<{ name: string }>('/api/admin/event/launch');
    busy = false;
    if (result) {
      toast.show(`Édition « ${result.name} » lancée`);
      tab = 'live';
    }
  }

  async function finish() {
    if (!event || busy) return;
    const confirmed = confirm(
      `Terminer l'édition « ${event.name} » ?\n\nLes résultats seront enregistrés dans l'historique et ne pourront plus être modifiés. Séries et comptages repartiront de zéro.`,
    );
    if (!confirmed) return;
    busy = true;
    const result = await admin.mutate<{ id: string; name: string }>('/api/admin/event/finish');
    busy = false;
    if (result) {
      toast.show(`Édition « ${result.name} » enregistrée`);
      tab = 'history';
    }
  }

  function editName() {
    if (!event || running) return;
    nameDraft = event.name;
    editingName = true;
  }

  async function saveName() {
    editingName = false;
    if (nameDraft.trim() && nameDraft !== event?.name) {
      await admin.mutate('/api/admin/event', { method: 'PATCH', body: { name: nameDraft.trim() } });
    }
  }
</script>

<div class="shell">
  <header>
    <Logo size={30} />

    {#if editingName}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input inline title"
        bind:value={nameDraft}
        autofocus
        onblur={saveName}
        onkeydown={(e) => e.key === 'Enter' && saveName()}
      />
    {:else}
      <!-- Le titre nomme l'edition ; il est fige pendant qu'elle se deroule. -->
      <button
        class="title-btn"
        disabled={running}
        title={running ? "Nom de l'édition en cours" : "Renommer l'édition"}
        onclick={editName}
      >
        {event?.name ?? 'Chargement…'}
      </button>
    {/if}

    <span
      class="lock"
      class:on={running}
      role="img"
      aria-label={running ? 'Configuration verrouillée' : 'Configuration modifiable'}
      title={running
        ? `Édition en cours depuis ${since} — configuration verrouillée`
        : 'Configuration modifiable'}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        {#if running}
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        {:else}
          <path d="M8 11V7a4 4 0 0 1 7.6-1.7" />
        {/if}
      </svg>
    </span>

    <span class="spacer"></span>

    {#if running}
      <button class="btn sm" onclick={finish} disabled={busy}>Terminer</button>
    {:else}
      <button class="btn primary sm" onclick={launch} disabled={busy || !event}>Lancer</button>
    {/if}

    <LinkBadge />
    <button class="btn ghost sm" onclick={() => session.logout()}>Quitter</button>
  </header>

  <nav class="tabs">
    {#each tabs as item (item.id)}
      <button class="tab" class:on={tab === item.id} onclick={() => (tab = item.id)}>
        {item.label}
      </button>
    {/each}
  </nav>

  <main class="canvas">
    {#if admin.error}
      <p class="err">{admin.error}</p>
    {/if}
    {#if tab === 'history'}
      <HistoryPanel />
    {:else if admin.data}
      {#if tab === 'exercises'}
        <ExercisesPanel locked={running} />
      {:else if tab === 'teams'}
        <TeamsPanel locked={running} />
      {:else if tab === 'heats'}
        <HeatsPanel />
      {:else}
        <LivePanel />
      {/if}
    {:else if admin.loading}
      <p class="muted center">Chargement…</p>
    {/if}
  </main>
</div>

<style>
  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--line-soft);
    flex-wrap: wrap;
  }
  .title-btn,
  .title {
    background: none;
    border: none;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--text);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: var(--r-sm);
  }
  .title-btn:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .title-btn:disabled {
    cursor: default;
  }
  .title {
    min-width: 220px;
  }
  /* Cadenas : un simple temoin, ferme pendant une edition. */
  .lock {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: var(--r-sm);
    color: var(--muted-2);
  }
  .lock.on {
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--line);
  }
  .lock svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 8px 14px 0;
    border-bottom: 1px solid var(--line-soft);
    overflow-x: auto;
  }
  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    padding: 8px 14px 10px;
    font-size: 14px;
    font-weight: 550;
    cursor: pointer;
    white-space: nowrap;
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  main {
    flex: 1;
    padding: 20px;
  }
  .err {
    color: var(--danger);
  }
  .center {
    text-align: center;
    padding: 40px;
  }
</style>
