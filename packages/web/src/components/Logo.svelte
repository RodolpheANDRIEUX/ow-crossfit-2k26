<script lang="ts">
  let { size = 30 }: { size?: number } = $props();

  // Version reduite du logo (scripts/make-icons.mjs). Si elle manque, on garde
  // la pastille « OW ».
  let failed = $state(false);
</script>

{#if failed}
  <span class="fallback" style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.42)}px">
    OW
  </span>
{:else}
  <img
    src="/logo-256.png"
    alt="OW"
    width={size}
    height={size}
    style="width:{size}px;height:{size}px"
    onerror={() => (failed = true)}
  />
{/if}

<style>
  img,
  .fallback {
    flex: none;
    border-radius: 24%;
    display: block;
  }
  img {
    object-fit: cover;
  }
  .fallback {
    display: grid;
    place-items: center;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 800;
    letter-spacing: -0.03em;
  }
</style>
