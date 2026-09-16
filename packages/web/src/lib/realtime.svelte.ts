import type { ServerMessage } from '@ow/shared';
import { getRole, getToken } from './api.ts';
import { syncClock } from './clock.ts';
import { queue } from './queue.svelte.ts';
import { runs } from './runs.svelte.ts';

export type LinkStatus = 'offline' | 'connecting' | 'online';

/**
 * Lien temps reel.
 *
 * Reconnexion automatique avec temporisation croissante, battement de coeur
 * pour detecter un reseau mobile qui a lache sans fermer la connexion, et
 * renvoi de la file d'attente des le retour du lien.
 */
class Realtime {
  status = $state<LinkStatus>('offline');
  /** Incremente a chaque modification de configuration cote organisation. */
  configVersion = $state(0);

  #socket: WebSocket | null = null;
  #retry = 1000;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #closed = false;

  connect(): void {
    this.#closed = false;
    const token = getToken();
    if (!token || this.#socket) return;

    this.status = 'connecting';
    const url = new URL('/ws', location.origin);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', token);

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;

    socket.onopen = () => {
      this.status = 'online';
      this.#retry = 1000;
      // Le lien revient : on pousse tout de suite ce qui attendait.
      void queue.flush();
      this.#pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
      }, 20000);
    };

    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (message.type === 'run') runs.apply(message.snapshot);
      else if (message.type === 'ops') {
        // Les arbitres recalculent l'etat sur leur journal local : on y fusionne
        // les actions des autres. Inutile pour l'organisation, qui lit les photos.
        if (getRole() === 'judge') void queue.seed(message.ops);
      } else if (message.type === 'config') this.configVersion = message.version;
      else if (message.type === 'hello' || message.type === 'pong') {
        // Recalage grossier de l'horloge ; l'appel HTTP fera mieux (mesure du trajet).
        syncClock(message.serverNow, Date.now() - 40, Date.now());
      }
    };

    const drop = () => {
      if (this.#pingTimer) clearInterval(this.#pingTimer);
      this.#pingTimer = null;
      this.#socket = null;
      this.status = 'offline';
      if (!this.#closed) this.#scheduleReconnect();
    };
    socket.onclose = drop;
    socket.onerror = () => socket.close();
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTimer) return;
    this.status = 'offline';
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.connect();
    }, this.#retry);
    this.#retry = Math.min(this.#retry * 1.8, 15000);
  }

  disconnect(): void {
    this.#closed = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#socket?.close();
    this.#socket = null;
    this.status = 'offline';
  }
}

export const realtime = new Realtime();

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => realtime.connect());
}
