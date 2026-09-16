<script lang="ts">
  import { formatDuration } from '@ow/shared';
  import type { RailItem } from '../lib/workout.ts';

  let { items }: { items: RailItem[] } = $props();
</script>

<!-- Fil du workout : ce qui est fait (avec son temps), ou l'on est, ce qui
     reste. Reprend la lecture des maquettes (coche verte sur ce qui est fait). -->
<nav class="rail">
  <span class="line"></span>
  {#each items as item (item.id)}
    <div
      class="step"
      class:done={item.state === 'done'}
      class:waiting={item.state === 'waiting'}
      class:current={item.state === 'current'}
    >
      <span class="dot">
        {#if item.state === 'done'}✓{:else if item.state === 'waiting'}!{/if}
      </span>
      <span class="name">{item.name}</span>
      {#if item.state === 'done' && item.splitMs !== null}
        <span class="split num">{formatDuration(item.splitMs)}</span>
      {/if}
    </div>
  {/each}
</nav>

<style>
  .rail {
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 4px;
    padding: 4px 2px 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .rail::-webkit-scrollbar {
    display: none;
  }
  .line {
    position: absolute;
    left: 8px;
    right: 8px;
    top: 15px;
    border-top: 1px dashed var(--line);
  }
  .step {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 68px;
    flex: 1;
    color: var(--muted-2);
    font-size: 12px;
  }
  .dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--bg);
    border: 1px solid var(--line);
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
  }
  .done .dot {
    color: var(--accent);
    border-color: rgb(34 197 94 / 0.45);
  }
  .waiting .dot {
    color: var(--warn);
    border-color: rgb(240 160 32 / 0.5);
  }
  .current .dot {
    background: var(--text);
    border-color: var(--text);
  }
  .current .name {
    color: var(--text);
    font-weight: 600;
  }
  .done .name {
    color: var(--muted);
  }
  .name {
    white-space: nowrap;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .split {
    font-size: 11px;
    color: var(--accent);
  }
</style>
