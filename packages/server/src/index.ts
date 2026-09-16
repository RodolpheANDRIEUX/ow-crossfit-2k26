import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { registerAdminRoutes } from './admin.ts';
import { verifyToken } from './auth.ts';
import { config } from './config.ts';
import { migrate, pool } from './db.ts';
import { register, startHeartbeat } from './realtime.ts';
import { HttpError, registerRoutes } from './routes.ts';
import { ensureEvent, ensureRuns } from './store.ts';

/**
 * TLS en direct, uniquement si un certificat est fourni.
 *
 * Sert a tester l'installation de la PWA sur un telephone en reseau local :
 * hors https (ou localhost), Chrome refuse le service worker et « creer un
 * raccourci » ne fabrique qu'un marque-page. En production, Traefik s'en charge
 * et ces variables restent vides.
 */
const tls =
  config.tlsCert && config.tlsKey
    ? { key: readFileSync(config.tlsKey), cert: readFileSync(config.tlsCert) }
    : null;

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Le front derriere Traefik : on fait confiance aux en-tetes du reverse proxy.
  trustProxy: true,
  bodyLimit: 1_000_000,
  ...(tls ? { https: tls } : {}),
});

app.setErrorHandler((error, _req, reply) => {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: 'Requête invalide', details: error.issues });
  }
  const failure = error as { statusCode?: number; message?: string };
  const status = failure.statusCode ?? 500;
  if (status >= 500) app.log.error(error);
  return reply.code(status).send({ error: failure.message || 'Erreur serveur' });
});

await app.register(cors, {
  origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((o) => o.trim()),
  credentials: true,
});
await app.register(websocket);

await registerRoutes(app);
await registerAdminRoutes(app);

app.get('/ws', { websocket: true }, (socket, req) => {
  const token = (req.query as { token?: string })?.token;
  if (!verifyToken(token)) {
    socket.close(4401, 'non autorise');
    return;
  }
  register(socket);
});

// Front compile : servi par le meme serveur en production (une seule origine,
// donc pas de CORS ni de configuration reseau supplementaire le jour J).
const publicDir = resolve(process.cwd(), config.publicDir);
if (existsSync(publicDir)) {
  await app.register(fastifyStatic, { root: publicDir, index: ['index.html'] });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'Route inconnue' });
    }
    return reply.sendFile('index.html');
  });
  app.log.info(`front servi depuis ${publicDir}`);
}

await migrate((msg) => app.log.info(msg));
const event = await ensureEvent();
await ensureRuns(event.id);
app.log.info(`événement « ${event.name} » (configuration ${event.locked ? 'verrouillée' : 'modifiable'})`);

const heartbeat = startHeartbeat();

await app.listen({ port: config.port, host: config.host });

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} recu, arret propre`);
  clearInterval(heartbeat);
  await app.close().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Un incident isole ne doit jamais tuer le serveur pendant l'evenement.
process.on('unhandledRejection', (reason) => app.log.error({ reason }, 'promesse rejetee'));
process.on('uncaughtException', (err) => app.log.error({ err }, 'exception non capturee'));
