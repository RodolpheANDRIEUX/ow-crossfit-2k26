<script lang="ts">
  import { pwa } from '../lib/pwa.svelte.ts';
  import Logo from '../components/Logo.svelte';
  import { toast } from '../lib/toast.svelte.ts';

  let busy = $state(false);

  async function install() {
    busy = true;
    const outcome = await pwa.install();
    busy = false;
    if (outcome === 'dismissed') toast.show('Installation annulée.');
    if (outcome === 'unavailable') toast.show("L'installation n'est pas disponible ici.");
  }
</script>

<!-- Ecran d'arrivee sur telephone : une seule action. L'arbitre installe
     l'application, point. Le reste attend derriere. -->
<main class="canvas">
  <div class="sheet">
    <div class="mark"><Logo size={76} /></div>
    <h1>Compteur OW</h1>

    {#if pwa.state === 'ready'}
      <p class="pitch">
        Installe l'application sur ton téléphone : elle s'ouvre en plein écran et
        continue de compter même sans réseau.
      </p>
      <button class="btn primary big" onclick={install} disabled={busy}>
        {busy ? 'Installation…' : "Télécharger l'app"}
      </button>
    {:else if pwa.state === 'apple'}
      <p class="pitch">Pour installer l'application sur iPhone :</p>
      <ol class="steps">
        <li>Appuie sur <strong>Partager</strong> en bas de Safari</li>
        <li>Choisis <strong>Sur l'écran d'accueil</strong></li>
      </ol>
    {:else if pwa.state === 'insecure'}
      <!-- Cas rencontre en test LAN : sans https, Chrome n'installe rien. -->
      <p class="pitch">
        L'installation demande une adresse <strong>https</strong>. Sur cette adresse
        (<span class="host">{location.host}</span>), le téléphone ne peut créer qu'un
        raccourci qui rouvre le navigateur.
      </p>
      <p class="hint tiny">
        Ouvre l'application via le nom de domaine en https pour pouvoir l'installer.
      </p>
    {:else}
      <p class="pitch">
        Ton navigateur ne propose pas l'installation pour l'instant. Tu peux
        continuer sans : tout fonctionne pareil, y compris hors-ligne.
      </p>
    {/if}

    <button class="fallback" onclick={() => pwa.continueInBrowser()}>
      Continuer dans le navigateur
    </button>
  </div>
</main>

<style>
  main {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 28px 20px calc(28px + env(safe-area-inset-bottom));
  }
  .sheet {
    width: min(100%, 380px);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
  }
  .mark {
    display: flex;
  }
  h1 {
    font-size: 28px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  .pitch {
    color: var(--muted);
    line-height: 1.5;
    font-size: 15px;
  }
  .host {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    color: var(--text);
  }
  .hint {
    color: var(--muted-2);
  }
  .steps {
    text-align: left;
    color: var(--muted);
    line-height: 1.7;
    margin: 0;
    padding-left: 20px;
    font-size: 15px;
  }
  .steps strong {
    color: var(--text);
  }
  .big {
    width: 100%;
    min-height: 58px;
    font-size: 17px;
    border-radius: var(--r-lg);
    margin-top: 6px;
  }
  /* Sortie de secours : disponible, mais jamais mise en avant. */
  .fallback {
    margin-top: 10px;
    background: none;
    border: none;
    color: var(--muted-2);
    font-size: 13px;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    padding: 6px;
  }
  .fallback:hover {
    color: var(--muted);
  }
</style>
