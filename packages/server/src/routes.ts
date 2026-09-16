import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CurrentAssignment } from '@ow/shared';
import { issueToken, normalizeCode, verifyToken, type Principal } from './auth.ts';
import { config } from './config.ts';
import { one, query } from './db.ts';
import { broadcast, clientCount } from './realtime.ts';
import {
  applyTimerAction,
  ensureEvent,
  ensureRuns,
  getExercises,
  getHeats,
  getOps,
  getOpsByIds,
  getSnapshots,
  getTeams,
  ingestOps,
  publishRun,
  recomputeRun,
} from './store.ts';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function principalOf(req: FastifyRequest): Principal | null {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  return verifyToken(token ?? (req.query as any)?.token);
}

export function requireAuth(req: FastifyRequest): Principal {
  const principal = principalOf(req);
  if (!principal) throw new HttpError(401, 'Session expirée, reconnecte-toi.');
  return principal;
}

export function requireAdmin(req: FastifyRequest): Principal {
  const principal = requireAuth(req);
  if (principal.role !== 'admin') throw new HttpError(403, "Réservé à l'organisation.");
  return principal;
}

/**
 * Horodatage client. On accepte une valeur decimale (le recalage d'horloge des
 * telephones en produit) et on l'arrondit : un tap ne doit jamais etre refuse
 * pour une histoire de virgule.
 */
const timestamp = z
  .number()
  .positive()
  .finite()
  .transform((value) => Math.round(value));

const opSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  type: z.enum(['rep', 'undo', 'min']),
  exerciseId: z.string().uuid().nullish(),
  memberId: z.string().uuid().nullish(),
  variantId: z.string().uuid().nullish(),
  clientTs: timestamp,
  targetOpId: z.string().uuid().nullish(),
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* Sante                                                            */
  /* ---------------------------------------------------------------- */

  app.get('/api/health', async () => ({
    ok: true,
    now: Date.now(),
    devices: clientCount(),
  }));

  /* ---------------------------------------------------------------- */
  /* Connexion                                                        */
  /* ---------------------------------------------------------------- */

  // Liste des participants pour l'ecran de connexion (sans les codes).
  app.get('/api/roster', async () => {
    const event = await ensureEvent();
    const teams = await getTeams(event.id);
    return {
      event: { name: event.name },
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        members: t.members.map((m) => ({ id: m.id, name: m.name })),
      })),
    };
  });

  app.post('/api/auth/judge', async (req) => {
    const body = z.object({ memberId: z.string().uuid(), code: z.string().min(1) }).parse(req.body);
    const rows = await query('select * from members where id = $1', [body.memberId]);
    const member = rows[0];
    if (!member || normalizeCode(member.code) !== normalizeCode(body.code)) {
      throw new HttpError(401, 'Code incorrect.');
    }
    const team = await one('select name from teams where id = $1', [member.team_id]);
    return {
      token: issueToken({ role: 'judge', memberId: member.id, name: member.name }),
      member: { id: member.id, name: member.name, teamId: member.team_id },
      teamName: team.name,
    };
  });

  app.post('/api/auth/admin', async (req) => {
    const body = z.object({ code: z.string().min(1) }).parse(req.body);
    if (normalizeCode(body.code) !== config.adminCode) throw new HttpError(401, 'Code incorrect.');
    return { token: issueToken({ role: 'admin' }) };
  });

  /* ---------------------------------------------------------------- */
  /* Etat complet (admin + tableau de bord live)                      */
  /* ---------------------------------------------------------------- */

  app.get('/api/state', async (req) => {
    const principal = requireAuth(req);
    const event = await ensureEvent();
    await ensureRuns(event.id);
    const [teams, exercises, heats, snapshots] = await Promise.all([
      getTeams(event.id),
      getExercises(event.id),
      getHeats(event.id),
      getSnapshots(event.id),
    ]);
    return {
      event,
      // Les codes de connexion ne sortent que vers l'organisation.
      teams:
        principal.role === 'admin'
          ? teams
          : teams.map((t) => ({ ...t, members: t.members.map((m) => ({ ...m, code: '' })) })),
      exercises,
      heats,
      snapshots,
      serverNow: Date.now(),
    };
  });

  /* ---------------------------------------------------------------- */
  /* Espace arbitre                                                   */
  /* ---------------------------------------------------------------- */

  app.get('/api/judge/me', async (req) => {
    const principal = requireAuth(req);
    if (principal.role !== 'judge') throw new HttpError(403, 'Compte arbitre requis.');
    const event = await ensureEvent();
    await ensureRuns(event.id);

    const memberRows = await query('select * from members where id = $1', [principal.memberId]);
    const me = memberRows[0];
    if (!me) throw new HttpError(401, 'Participant inconnu.');
    const myTeam = await one('select name from teams where id = $1', [me.team_id]);

    // Seule l'affectation de la serie en cours est renvoyee : pas de choix a faire.
    // Si l'organisation fait tourner deux series en meme temps et qu'une meme
    // personne y arbitre, on montre celle qui est reellement en train de se
    // jouer plutot qu'une serie deja terminee.
    const rows = await query(
      `select a.* from assignments a
       join heats h on h.id = a.heat_id
       join runs r on r.id = a.run_id
       where a.judge_member_id = $1 and h.status = 'active'
       order by case r.status when 'running' then 0 when 'paused' then 1
                              when 'pending' then 2 else 3 end, h.position
       limit 1`,
      [principal.memberId],
    );
    const row = rows[0];

    const exercises = await getExercises(event.id);
    const identity = {
      member: { id: me.id, name: me.name, teamId: me.team_id },
      teamName: myTeam.name,
      event,
      // Toujours envoyees : avant le lancement, le participant consulte les epreuves.
      exercises,
    };
    // Avant le lancement (ou entre deux editions), personne n'a d'affectation a l'ecran.
    if (!row || event.runningSince === null) return { ...identity, assignment: null };

    const teams = await getTeams(event.id);
    const snapshot = await recomputeRun(row.run_id);
    const team = teams.find((t) => t.id === row.team_id);
    if (!team) throw new HttpError(500, 'Affectation incohérente.');

    const current: CurrentAssignment = {
      assignment: {
        id: row.id,
        heatId: row.heat_id,
        runId: row.run_id,
        teamId: row.team_id,
        judgeMemberId: row.judge_member_id,
        role: row.role,
      },
      run: snapshot.run,
      team,
      // Tout le workout : l'ecran passe d'une epreuve a la suivante sans rien redemander.
      exercises,
    };

    return {
      ...identity,
      assignment: current,
      snapshot,
      ops: await getOps(row.run_id),
      // Les deux autres arbitres du passage : chacun sait avec qui il travaille.
      crew: (
        await query(
          `select a.role, m.name as judge_name from assignments a
           join members m on m.id = a.judge_member_id where a.run_id = $1`,
          [row.run_id],
        )
      ).map((c) => ({ role: c.role, judgeName: c.judge_name })),
    };
  });

  app.get('/api/runs/:id/ops', async (req) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return { ops: await getOps(id) };
  });

  /* ---------------------------------------------------------------- */
  /* Comptage                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Ingestion des taps (lot). Point critique de l'application :
   * idempotent par identifiant d'operation, donc rejouable autant de fois que
   * necessaire par un telephone qui resynchronise.
   */
  app.post('/api/ops', async (req) => {
    const principal = requireAuth(req);
    const body = z.object({ ops: z.array(opSchema).max(500) }).parse(req.body);
    const judgeId = principal.role === 'judge' ? principal.memberId : null;

    const result = await ingestOps(body.ops, judgeId);
    // Les operations telles qu'enregistrees (points et epreuve relus en base).
    const stored = await getOpsByIds(result.accepted);
    const snapshots = [];
    for (const runId of result.runIds) {
      const ops = stored.filter((op) => op.runId === runId);
      // Le journal d'abord, la photo ensuite : chaque telephone recalcule l'etat
      // sur le meme journal que le serveur, sans jamais compter deux fois.
      if (ops.length > 0) broadcast({ type: 'ops', runId, ops });
      snapshots.push(await publishRun(runId));
    }

    return {
      accepted: result.accepted,
      rejected: result.rejected,
      ops: stored,
      snapshots,
      serverNow: Date.now(),
    };
  });

  app.post('/api/runs/:id/timer', async (req) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        action: z.enum(['start', 'pause', 'resume']),
        at: timestamp.optional(),
      })
      .parse(req.body);
    const event = await ensureEvent();
    if (event.runningSince === null) throw new HttpError(409, "L'édition n'est pas lancée.");
    return { snapshot: await applyTimerAction(id, body.action, body.at ?? Date.now()) };
  });

  /* ---------------------------------------------------------------- */
  /* Images                                                           */
  /* ---------------------------------------------------------------- */

  // Public : une balise <img> n'envoie pas de jeton. Immuable, donc cache long.
  app.get('/api/images/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await query('select mime, data from images where id = $1', [id]);
    const image = rows[0];
    if (!image) throw new HttpError(404, 'Image introuvable.');
    return reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .type(image.mime as string)
      .send(image.data as Buffer);
  });
}
