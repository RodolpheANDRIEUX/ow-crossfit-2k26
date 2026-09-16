<script lang="ts">
  import { admin } from '../lib/adminState.svelte.ts';
  import ImageSlot from '../components/ImageSlot.svelte';

  let { locked }: { locked: boolean } = $props();

  const exercises = $derived(admin.data?.exercises ?? []);
  const minReps = $derived(admin.data?.event.minRepsPerMember ?? 5);

  let newExercise = $state('');
  let variantDrafts = $state<Record<string, { name: string; points: number }>>({});

  function draft(exerciseId: string): { name: string; points: number } {
    return variantDrafts[exerciseId] ?? { name: '', points: 1 };
  }

  function setDraft(exerciseId: string, patch: Partial<{ name: string; points: number }>) {
    variantDrafts[exerciseId] = { ...draft(exerciseId), ...patch };
  }

  async function addExercise() {
    const name = newExercise.trim();
    if (!name) return;
    newExercise = '';
    await admin.mutate('/api/admin/exercises', { body: { name } });
  }

  async function addVariant(exerciseId: string) {
    const value = draft(exerciseId);
    if (!value.name.trim()) return;
    const body = { name: value.name.trim(), points: Number(value.points) || 1 };
    variantDrafts[exerciseId] = { name: '', points: 1 };
    await admin.mutate(`/api/admin/exercises/${exerciseId}/variants`, { body });
  }

  const patchExercise = (id: string, body: Record<string, unknown>) =>
    admin.mutate(`/api/admin/exercises/${id}`, { method: 'PATCH', body });

  const patchVariant = (id: string, body: Record<string, unknown>) =>
    admin.mutate(`/api/admin/variants/${id}`, { method: 'PATCH', body });

  async function move(index: number, direction: -1 | 1) {
    const current = exercises[index];
    const other = exercises[index + direction];
    if (!current || !other) return;
    await patchExercise(current.id, { position: other.position });
    await patchExercise(other.id, { position: current.position });
  }

  async function removeExercise(id: string, name: string) {
    if (!confirm(`Supprimer l'épreuve « ${name} » ? Les comptages associés seront perdus.`)) return;
    await admin.mutate(`/api/admin/exercises/${id}`, { method: 'DELETE' });
  }

  const removeVariant = (id: string) =>
    admin.mutate(`/api/admin/variants/${id}`, { method: 'DELETE' });

  const setMinReps = (value: number) =>
    admin.mutate('/api/admin/event', { method: 'PATCH', body: { minRepsPerMember: value } });
</script>

<div class="head">
  <div>
    <h2>Épreuves</h2>
    <p class="muted tiny">
      Objectif de points à atteindre, et variantes valant chacune un nombre de points.
    </p>
  </div>
  <span class="spacer"></span>
  <label class="row tiny muted">
    Minimum de reps par participant
    <input
      class="input num-input"
      type="number"
      min="0"
      max="100"
      value={minReps}
      disabled={locked}
      onchange={(e) => setMinReps(Number(e.currentTarget.value))}
    />
  </label>
</div>

<div class="grid">
  {#each exercises as exercise, index (exercise.id)}
    <section class="card ex">
      <header>
        <ImageSlot
          imageId={exercise.imageId}
          {locked}
          size={44}
          label={exercise.name}
          onchange={(imageId) => patchExercise(exercise.id, { imageId })}
        />
        <input
          class="input inline name"
          value={exercise.name}
          disabled={locked}
          onchange={(e) => patchExercise(exercise.id, { name: e.currentTarget.value })}
        />
        {#if !locked}
          <div class="order">
            <button class="btn ghost sm" onclick={() => move(index, -1)} disabled={index === 0}
              >↑</button
            >
            <button
              class="btn ghost sm"
              onclick={() => move(index, 1)}
              disabled={index === exercises.length - 1}>↓</button
            >
          </div>
          <button class="btn ghost sm" onclick={() => removeExercise(exercise.id, exercise.name)}
            >✕</button
          >
        {/if}
      </header>

      <label class="row target">
        <span class="tiny muted">Objectif</span>
        <input
          class="input num-input"
          type="number"
          min="1"
          value={exercise.targetPoints}
          disabled={locked}
          onchange={(e) => patchExercise(exercise.id, { targetPoints: Number(e.currentTarget.value) })}
        />
        <span class="tiny muted">points</span>
      </label>

      <ul>
        {#each exercise.variants as variant (variant.id)}
          <li>
            <ImageSlot
              imageId={variant.imageId}
              {locked}
              size={32}
              label={variant.name}
              onchange={(imageId) => patchVariant(variant.id, { imageId })}
            />
            <input
              class="input inline"
              value={variant.name}
              disabled={locked}
              onchange={(e) => patchVariant(variant.id, { name: e.currentTarget.value })}
            />
            <input
              class="input num-input"
              type="number"
              min="1"
              value={variant.points}
              disabled={locked}
              onchange={(e) => patchVariant(variant.id, { points: Number(e.currentTarget.value) })}
            />
            {#if !locked}
              <button class="btn ghost sm" onclick={() => removeVariant(variant.id)}>✕</button>
            {/if}
          </li>
        {/each}
      </ul>

      {#if exercise.variants.length === 0}
        <p class="tiny warn-text">Aucune variante : les arbitres n'auront rien à taper.</p>
      {/if}

      {#if !locked}
        <form
          class="add"
          onsubmit={(e) => {
            e.preventDefault();
            addVariant(exercise.id);
          }}
        >
          <input
            class="input"
            placeholder="Nouvelle variante"
            value={draft(exercise.id).name}
            oninput={(e) => setDraft(exercise.id, { name: e.currentTarget.value })}
          />
          <input
            class="input num-input"
            type="number"
            min="1"
            value={draft(exercise.id).points}
            oninput={(e) => setDraft(exercise.id, { points: Number(e.currentTarget.value) })}
          />
          <button class="btn" type="submit">+</button>
        </form>
      {/if}
    </section>
  {/each}

  {#if !locked}
    <form
      class="card new"
      onsubmit={(e) => {
        e.preventDefault();
        addExercise();
      }}
    >
      <input class="input" placeholder="Nom de la nouvelle épreuve" bind:value={newExercise} />
      <button class="btn" type="submit" disabled={!newExercise.trim()}>Ajouter l'épreuve</button>
    </form>
  {/if}
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  h2 {
    font-size: 18px;
    font-weight: 600;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 14px;
    align-items: start;
  }
  .ex {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ex header {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .name {
    font-weight: 600;
    font-size: 15px;
    flex: 1;
    min-width: 0;
  }
  .order {
    display: flex;
    gap: 0;
  }
  .target {
    gap: 8px;
  }
  .num-input {
    width: 78px;
    text-align: center;
    min-height: 34px;
    padding: 4px 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  li .input.inline {
    flex: 1;
    min-width: 0;
  }
  .add {
    display: flex;
    gap: 6px;
  }
  .add .input:first-child {
    flex: 1;
    min-width: 0;
  }
  .new {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-style: dashed;
  }
  .warn-text {
    color: var(--warn);
  }
</style>
