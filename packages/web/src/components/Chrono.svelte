<script lang="ts">
  import { elapsedAt, formatChrono } from '@ow/shared';
  import type { Segment } from '@ow/shared';
  import { nowTs } from '../lib/clock.ts';

  interface Props {
    segments: Segment[];
    /** Temps officiel fige (passage termine). */
    frozenMs?: number | null;
    running?: boolean;
  }
  let { segments, frozenMs = null, running = false }: Props = $props();

  let now = $state(nowTs());

  $effect(() => {
    if (!running) return;
    // 47 ms : les centiemes defilent sans saccade et sans surcharger le rendu.
    const timer = setInterval(() => (now = nowTs()), 47);
    return () => clearInterval(timer);
  });

  const value = $derived(frozenMs ?? elapsedAt(segments, now));
</script>

<span class="num">{formatChrono(value)}</span>

<style>
  span {
    font-weight: 600;
  }
</style>
