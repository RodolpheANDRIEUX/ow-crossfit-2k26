<script lang="ts">
  import type { CurrentAssignment, EventConfig, Exercise, Op, RunSnapshot } from '@ow/shared';
  import { api } from '../lib/api.ts';
  import { queue } from '../lib/queue.svelte.ts';
  import { realtime } from '../lib/realtime.svelte.ts';
  import { runs } from '../lib/runs.svelte.ts';
  import { scopedKey } from '../lib/scope.ts';
  import { session } from '../lib/session.svelte.ts';
  import { theme } from '../lib/theme.svelte.ts';
  import LinkBadge from '../components/LinkBadge.svelte';
  import Catalog from './Catalog.svelte';
  import Counter from './Counter.svelte';
  import Timer from './Timer.svelte';
  import FormJudge from './FormJudge.svelte';

  interface Payload {
    member: { id: string; name: string; teamId: string };
    teamName: string;
    event: EventConfig;
    exercises?: Exercise[];
    assignment: CurrentAssignment | null;
    snapshot?: RunSnapshot;
    ops?: Op[];
    crew?: { role: string; judgeName: string }[];
  }

  const CACHE = scopedKey('ow.judge');

  function readCache(): Payload | null {
    try {
      const raw = localStorage.getItem(CACHE);
      return raw ? (JSON.parse(raw) as Payload) : null;
    } catch {
      return null;
    }
  }

  // L'affectation est gardee en cache : un telephone qui redemarre sans reseau
  // retrouve son ecran de comptage au lieu d'une page vide.
  let payload = $state<Payload | null>(readCache());
  let loaded = $state(false);
  let menuOpen = $state(false);

  // Avant le lancement de l'edition, chacun consulte les epreuves ; ensuite,
  // chacun voit son poste.
  const launched = $derived(Boolean(payload?.event.runningSince));

  async function load() {
    try {
      const data = await api<Payload>('/api/judge/me');
      payload = data;
      try {
        localStorage.setItem(CACHE, JSON.stringify(data));
      } catch {
        // pas de cache disponible : on fonctionnera en ligne uniquement
      }
      if (data.snapshot) runs.apply(data.snapshot);
      if (data.ops?.length) await queue.seed(data.ops);
    } catch {
      // hors-ligne : on garde l'affectation en cache
    } finally {
      loaded = true;
    }
  }

  $effect(() => {
    // Rechargement quand l'organisation lance, termine ou change le deroulement,
    // et au retour du reseau.
    void realtime.configVersion;
    void realtime.status;
    void load();
  });

  function logout() {
    try {
      localStorage.removeItem(CACHE);
    } catch {
      /* rien a nettoyer */
    }
    session.logout();
  }
</script>

<div class="shell">
  <header>
    <div class="who">
      <strong>{payload?.member.name ?? session.displayName}</strong>
      <span class="muted tiny">{payload?.teamName ?? ''}</span>
    </div>
    <LinkBadge />
    <button class="btn ghost sm" onclick={() => (menuOpen = !menuOpen)} aria-label="Menu">⋯</button>
    {#if menuOpen}
      <div class="menu card">
        <button class="btn ghost" onclick={() => (void load(), (menuOpen = false))}>Actualiser</button>
        <button class="btn ghost" onclick={() => (theme.toggle(), (menuOpen = false))}>
          {theme.current === 'dark' ? 'Thème clair' : 'Thème sombre'}
        </button>
        <button class="btn ghost" onclick={logout}>Se déconnecter</button>
      </div>
    {/if}
  </header>

  {#if payload && !launched}
    <Catalog exercises={payload.exercises ?? []} event={payload.event} />
  {:else if payload?.assignment}
    <!-- Un poste, un ecran. L'arbitre n'a jamais a choisir ce qu'il regarde. -->
    {#if payload.assignment.assignment.role === 'timer'}
      <Timer assignment={payload.assignment} event={payload.event} crew={payload.crew ?? []} />
    {:else if payload.assignment.assignment.role === 'form'}
      <FormJudge assignment={payload.assignment} crew={payload.crew ?? []} />
    {:else}
      <Counter assignment={payload.assignment} event={payload.event} crew={payload.crew ?? []} />
    {/if}
  {:else}
    <section class="waiting canvas">
      <div class="card idle">
        <h2>Pas d'affectation en cours</h2>
        <p class="muted">
          Ton écran s'ouvrira tout seul dès que l'organisation lancera ta série.
          Tu n'as rien à chercher.
        </p>
        {#if !loaded}
          <p class="tiny muted">Chargement…</p>
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  header {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: calc(8px + env(safe-area-inset-top)) 14px 8px;
    border-bottom: 1px solid var(--line-soft);
  }
  .who {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    margin-right: auto;
    min-width: 0;
  }
  .who strong {
    font-weight: 600;
    font-size: 15px;
  }
  .menu {
    position: absolute;
    right: 12px;
    top: 100%;
    z-index: 20;
    display: flex;
    flex-direction: column;
    padding: 6px;
    box-shadow: var(--shadow);
  }
  .menu .btn {
    justify-content: flex-start;
  }
  .waiting {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .idle {
    max-width: 360px;
    padding: 26px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h2 {
    font-size: 19px;
    font-weight: 600;
  }
</style>
