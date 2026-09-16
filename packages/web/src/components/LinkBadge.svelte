<script lang="ts">
  import { queue } from '../lib/queue.svelte.ts';
  import { realtime } from '../lib/realtime.svelte.ts';

  const pending = $derived(queue.pendingCount);
  const label = $derived(
    pending > 0
      ? `${pending} en attente`
      : realtime.status === 'online'
        ? 'Synchronisé'
        : realtime.status === 'connecting'
          ? 'Connexion…'
          : 'Hors-ligne',
  );
</script>

<!-- Etat du lien : jamais alarmant. Hors-ligne, le comptage continue et
     l'arbitre voit simplement que les taps sont en attente. Sur telephone, un
     simple point de couleur suffit : vert synchronise, orange en attente,
     gris hors-ligne. -->
<span
  class="pill link"
  class:ok={realtime.status === 'online' && pending === 0}
  class:warn={pending > 0}
  role="status"
  aria-label={label}
  title={label}
>
  <i class:live={realtime.status === 'online' || pending > 0}></i><span class="text">{label}</span>
</span>

<style>
  i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--muted-2);
    display: inline-block;
    flex: none;
  }
  i.live {
    background: currentColor;
  }
  @media (max-width: 640px) {
    .link {
      padding: 7px;
      gap: 0;
    }
    .text {
      display: none;
    }
    i {
      width: 9px;
      height: 9px;
    }
  }
</style>
