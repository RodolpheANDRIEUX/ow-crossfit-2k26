import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
// Le theme est applique avant le premier rendu : aucun flash de la mauvaise couleur.
import './lib/theme.svelte.ts';
import { queue } from './lib/queue.svelte.ts';
import { realtime } from './lib/realtime.svelte.ts';
import { session } from './lib/session.svelte.ts';

// La file d'attente est relue avant tout affichage : les taps d'une session
// precedente (onglet ferme, telephone eteint) repartent immediatement.
void queue.init();
if (session.authenticated) realtime.connect();

export default mount(App, { target: document.getElementById('app')! });
