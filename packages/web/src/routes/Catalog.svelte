<script lang="ts">
  import type { EventConfig, Exercise } from '@ow/shared';
  import { imageUrl } from '../lib/images.ts';

  interface Props {
    exercises: Exercise[];
    event: EventConfig;
  }
  let { exercises, event }: Props = $props();

  let openId = $state<string | null>(null);
  const open = $derived(exercises.find((e) => e.id === openId) ?? null);
  // Une colonne d'images seulement si l'epreuve en a : sinon les variantes
  // occupent toute la largeur au lieu de laisser un trou.
  const withImages = $derived(open?.variants.some((v) => v.imageId) ?? false);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (openId = null)} />

<!-- Avant le lancement : de quoi se preparer. Les epreuves du workout, dans
     l'ordre, et pour chacune ses variantes et ce qu'elles rapportent. -->
<main class="canvas">
  <header class="intro">
    <h1>Les épreuves</h1>
    <p class="muted">Dans l'ordre du workout. Ton affectation s'affichera ici au lancement.</p>
  </header>

  <div class="grid">
    {#each exercises as exercise, index (exercise.id)}
      <button class="tile card" onclick={() => (openId = exercise.id)}>
        <!-- Cadre au format fixe : une image haute, large ou minuscule y tient
             toujours entiere, sans deformer la grille. -->
        <span class="thumb" class:empty={!exercise.imageId}>
          {#if exercise.imageId}
            <img src={imageUrl(exercise.imageId)} alt="" />
          {:else}
            <span class="initial">{exercise.name.slice(0, 1)}</span>
          {/if}
          <span class="order num">{index + 1}</span>
        </span>
        <span class="label">
          <span class="name">{exercise.name}</span>
          <span class="tiny muted">{exercise.targetPoints} points</span>
        </span>
      </button>
    {:else}
      <p class="muted">Les épreuves ne sont pas encore configurées.</p>
    {/each}
  </div>
</main>

{#if open}
  <div class="sheet-backdrop">
    <button class="scrim" aria-label="Fermer" onclick={() => (openId = null)}></button>
    <div class="sheet card" role="dialog" aria-modal="true" aria-label={open.name} tabindex="-1">
      <header class="sheet-head">
        <div>
          <h2>{open.name}</h2>
          <p class="tiny muted">
            Objectif {open.targetPoints} points{event.minRepsPerMember > 0
              ? ` · minimum ${event.minRepsPerMember} répétitions par participant`
              : ''}
          </p>
        </div>
        <button class="btn ghost sm" onclick={() => (openId = null)}>Fermer</button>
      </header>

      <div class="sheet-body">
        {#if open.imageId}
          <div class="hero">
            <img src={imageUrl(open.imageId)} alt="" />
          </div>
        {/if}

        <ul class="variants" class:with-images={withImages}>
          {#each open.variants as variant (variant.id)}
            <li>
              {#if withImages}
                <span class="thumb sm" class:empty={!variant.imageId}>
                  {#if variant.imageId}
                    <img src={imageUrl(variant.imageId)} alt="" />
                  {/if}
                </span>
              {/if}
              <span class="variant-name">{variant.name}</span>
              <span class="variant-points num">+{variant.points}</span>
            </li>
          {:else}
            <li class="none"><span class="variant-name">Aucune variante configurée.</span></li>
          {/each}
        </ul>
      </div>
    </div>
  </div>
{/if}

<style>
  main {
    flex: 1;
    padding: 18px 14px calc(18px + env(safe-area-inset-bottom));
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
  }
  .intro {
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  h1 {
    font-size: 24px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    touch-action: manipulation;
  }
  .tile:active {
    transform: scale(0.985);
  }
  .label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 2px 2px;
  }
  .name {
    font-weight: 600;
    font-size: 15px;
  }

  /*
   * Cadre d'image. L'image est posee en absolu et contenue dans le cadre :
   * quelles que soient ses dimensions (portrait, panorama, vignette), elle
   * tient entiere, centree, et ne deborde jamais sur le reste de la page.
   */
  .thumb {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    border-radius: var(--r-md);
    background: var(--tap);
    overflow: hidden;
  }
  .thumb.empty {
    background: var(--surface-2);
  }
  .thumb img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 6px;
  }
  .thumb.sm {
    width: 56px;
    aspect-ratio: 1;
    flex: none;
    border-radius: var(--r-sm);
    background: rgb(0 0 0 / 0.05);
  }
  .thumb.sm img {
    padding: 3px;
  }
  .initial {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 36px;
    font-weight: 700;
    color: var(--muted-2);
  }
  .order {
    position: absolute;
    top: 6px;
    left: 6px;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.55);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    display: grid;
    place-items: center;
    line-height: 1;
  }

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.55);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 50;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .sheet {
    position: relative;
    width: min(100%, 560px);
    max-height: 85dvh;
    border-radius: var(--r-xl) var(--r-xl) 0 0;
    padding: 16px 16px calc(18px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  /* Sur grand ecran, une fiche centree plutot qu'un tiroir colle en bas. */
  @media (min-width: 640px) {
    .sheet-backdrop {
      align-items: center;
      padding: 24px;
    }
    .sheet {
      border-radius: var(--r-xl);
      padding-bottom: 18px;
    }
  }
  .sheet-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .sheet-head h2 {
    font-size: 20px;
    font-weight: 650;
  }
  .sheet-body {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .hero {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 10;
    max-height: 40dvh;
    border-radius: var(--r-lg);
    background: var(--tap);
    overflow: hidden;
    flex: none;
  }
  .hero img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 8px;
  }
  .variants {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .variants li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    border-radius: var(--r-lg);
    background: var(--tap);
    color: var(--tap-text);
    border: 1px solid var(--tap-border);
  }
  .variants.with-images li {
    padding-left: 8px;
  }
  .variant-name {
    flex: 1;
    min-width: 0;
    font-weight: 550;
  }
  .variant-points {
    font-size: 22px;
    font-weight: 700;
    color: var(--tap-muted);
  }
  .variants li.none {
    color: var(--tap-muted);
    font-weight: 400;
  }
</style>
