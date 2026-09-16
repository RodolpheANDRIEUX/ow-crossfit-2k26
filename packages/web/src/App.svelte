<script lang="ts">
  import { pwa } from './lib/pwa.svelte.ts';
  import { router } from './lib/router.svelte.ts';
  import { session } from './lib/session.svelte.ts';
  import { toast } from './lib/toast.svelte.ts';
  import Welcome from './routes/Welcome.svelte';
  import Login from './routes/Login.svelte';
  import Judge from './routes/Judge.svelte';
  import Admin from './routes/Admin.svelte';

  const view = $derived.by(() => {
    if (session.authenticated) return session.role === 'admin' ? 'admin' : 'judge';
    // Sur telephone, on ne montre qu'une chose a la fois : d'abord installer
    // l'application, la connexion ensuite.
    if (pwa.phone && !pwa.installed && !pwa.bypassed) return 'welcome';
    return 'login';
  });

  // L'organisation et les arbitres n'ont pas la meme adresse : une personne qui
  // recharge retombe sur son ecran, sans avoir a re-choisir quoi que ce soit.
  $effect(() => {
    const wanted = view === 'admin' ? '/admin' : view === 'judge' ? '/arbitre' : '/';
    if (router.path !== wanted) router.replace(wanted);
  });
</script>

{#if view === 'welcome'}
  <Welcome />
{:else if view === 'login'}
  <Login />
{:else if view === 'admin'}
  <Admin />
{:else}
  <Judge />
{/if}

{#if toast.message}
  <div class="toast" role="status">{toast.message}</div>
{/if}
