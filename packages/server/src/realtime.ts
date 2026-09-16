import type { WebSocket } from 'ws';
import type { ServerMessage } from '@ow/shared';

interface Client {
  socket: WebSocket;
  isAlive: boolean;
}

const clients = new Set<Client>();
let configVersion = 1;

/**
 * Diffusion a tous les appareils connectes.
 *
 * L'evenement compte moins de 20 appareils : diffuser l'integralite de l'etat
 * a tout le monde est plus sur qu'un routage par abonnement (aucun risque
 * d'appareil oublie), et reste negligeable en volume.
 */
export function broadcast(message: ServerMessage): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.socket.readyState !== 1) continue;
    try {
      client.socket.send(payload);
    } catch {
      // socket mourant : le heartbeat le nettoiera
    }
  }
}

export function bumpConfigVersion(): number {
  configVersion += 1;
  broadcast({ type: 'config', version: configVersion });
  return configVersion;
}

export function getConfigVersion(): number {
  return configVersion;
}

export function register(socket: WebSocket): void {
  const client: Client = { socket, isAlive: true };
  clients.add(client);

  socket.send(JSON.stringify({ type: 'hello', serverNow: Date.now() } satisfies ServerMessage));

  socket.on('pong', () => {
    client.isAlive = true;
  });
  socket.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg?.type === 'ping') {
        client.isAlive = true;
        socket.send(JSON.stringify({ type: 'pong', serverNow: Date.now() } satisfies ServerMessage));
      }
    } catch {
      // message illisible : ignore
    }
  });
  socket.on('close', () => clients.delete(client));
  socket.on('error', () => clients.delete(client));
}

export function clientCount(): number {
  return clients.size;
}

/** Detecte les appareils partis sans fermer proprement (perte de reseau mobile). */
export function startHeartbeat(intervalMs = 20_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        clients.delete(client);
        try {
          client.socket.terminate();
        } catch {
          /* deja ferme */
        }
        continue;
      }
      client.isAlive = false;
      try {
        client.socket.ping();
      } catch {
        clients.delete(client);
      }
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}
