<script lang="ts">
  import { api, ApiError } from '../lib/api.ts';
  import { imageUrl, prepareImage } from '../lib/images.ts';
  import { toast } from '../lib/toast.svelte.ts';

  interface Props {
    imageId: string | null;
    locked: boolean;
    size?: number;
    label: string;
    onchange: (imageId: string | null) => unknown;
  }
  let { imageId, locked, size = 44, label, onchange }: Props = $props();

  let busy = $state(false);
  let input: HTMLInputElement | undefined = $state();

  async function pick(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    busy = true;
    try {
      const dataUrl = await prepareImage(file);
      const { id } = await api<{ id: string }>('/api/admin/images', { method: 'POST', body: { dataUrl } });
      await onchange(id);
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Image illisible.');
    } finally {
      busy = false;
      if (input) input.value = '';
    }
  }
</script>

{#if imageId || !locked}
  <div class="slot" style="--size:{size}px">
    <button
      class="pick"
      class:empty={!imageId}
      disabled={locked || busy}
      title={imageId ? `Changer l'image — ${label}` : `Ajouter une image — ${label}`}
      aria-label={imageId ? `Changer l'image — ${label}` : `Ajouter une image — ${label}`}
      onclick={() => input?.click()}
    >
      {#if imageId}
        <img src={imageUrl(imageId)} alt="" />
      {:else}
        <span aria-hidden="true">{busy ? '…' : '+'}</span>
      {/if}
    </button>
    {#if imageId && !locked}
      <button class="remove" aria-label={`Retirer l'image — ${label}`} onclick={() => onchange(null)}>✕</button>
    {/if}
    <input bind:this={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onchange={pick} />
  </div>
{/if}

<style>
  .slot {
    position: relative;
    flex: none;
    width: var(--size);
    height: var(--size);
  }
  .pick {
    width: 100%;
    height: 100%;
    padding: 0;
    border-radius: var(--r-sm);
    border: 1px solid var(--line);
    background: var(--tap);
    display: grid;
    place-items: center;
    overflow: hidden;
    cursor: pointer;
  }
  .pick.empty {
    background: transparent;
    border-style: dashed;
    color: var(--muted-2);
    font-size: 18px;
  }
  .pick:disabled {
    cursor: default;
  }
  .pick img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .remove {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--surface-3);
    color: var(--muted);
    font-size: 9px;
    line-height: 1;
    padding: 0;
    cursor: pointer;
    display: none;
  }
  .slot:hover .remove,
  .slot:focus-within .remove {
    display: block;
  }
</style>
