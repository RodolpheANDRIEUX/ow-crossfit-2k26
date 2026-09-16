import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateCode } from './auth.ts';
import { one, query, transaction } from './db.ts';
import { drawHeats } from './draw.ts';
import { finishEdition, getEdition, launchEdition, listEditions } from './editions.ts';
import { bumpConfigVersion } from './realtime.ts';
import { HttpError, requireAdmin } from './routes.ts';
import { applyTimerAction, ensureEvent, ensureRuns, getTeams } from './store.ts';

const uuid = z.string().uuid();

/**
 * Verrou de configuration, actif pendant toute une edition.
 *
 * Tous les passages sont recalcules a partir du journal : modifier un objectif,
 * des points, l'ordre des epreuves ou le minimum de reps changerait les temps
 * officiels des equipes deja passees. Pendant une edition, la configuration
 * est donc refusee ici — pas seulement grisee a l'ecran.
 */
async function assertUnlocked(): Promise<void> {
  const event = await ensureEvent();
  if (event.runningSince !== null) {
    throw new HttpError(409, "Configuration verrouillée pendant l'édition en cours.");
  }
}

async function uniqueCode(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const code = generateCode(4);
    const rows = await query('select 1 from members where upper(code) = $1', [code]);
    if (rows.length === 0) return code;
  }
  return generateCode(6);
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/admin')) requireAdmin(req);
  });

  const touched = async <T>(value: T): Promise<T> => {
    bumpConfigVersion();
    return value;
  };

  /* ---------------------------------------------------------------- */
  /* Evenement                                                        */
  /* ---------------------------------------------------------------- */

  app.patch('/api/admin/event', async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        minRepsPerMember: z.number().int().min(0).max(100).optional(),
        teamSize: z.number().int().min(1).max(10).optional(),
      })
      .parse(req.body);
    // Le titre nomme l'edition : il ne change pas pendant qu'elle se deroule.
    await assertUnlocked();
    const event = await ensureEvent();
    await query(
      `update events set name = coalesce($2, name),
       min_reps_per_member = coalesce($3, min_reps_per_member), team_size = coalesce($4, team_size)
       where id = $1`,
      [event.id, body.name ?? null, body.minRepsPerMember ?? null, body.teamSize ?? null],
    );
    return touched({ ok: true });
  });

  /* ---------------------------------------------------------------- */
  /* Editions                                                         */
  /* ---------------------------------------------------------------- */

  app.post('/api/admin/event/launch', async () => touched(await launchEdition()));

  app.post('/api/admin/event/finish', async () => touched(await finishEdition()));

  app.get('/api/admin/editions', async () => ({ editions: await listEditions() }));

  app.get('/api/admin/editions/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return getEdition(id);
  });

  /* ---------------------------------------------------------------- */
  /* Images                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Televersement d'une image (deja redimensionnee par le navigateur). Stockee
   * en base : une seule sauvegarde contient tout, et chaque image est immuable.
   */
  app.post('/api/admin/images', { bodyLimit: 4_000_000 }, async (req) => {
    const body = z.object({ dataUrl: z.string().max(3_000_000) }).parse(req.body);
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl);
    if (!match) throw new HttpError(400, "Format d'image non pris en charge (PNG, JPEG ou WebP).");
    const data = Buffer.from(match[2] as string, 'base64');
    if (data.length > 1_500_000) throw new HttpError(413, 'Image trop lourde (1,5 Mo maximum).');
    const image = await one('insert into images (mime, data) values ($1, $2) returning id', [match[1], data]);
    return { id: image.id };
  });

  /* ---------------------------------------------------------------- */
  /* Equipes et membres                                               */
  /* ---------------------------------------------------------------- */

  app.post('/api/admin/teams', async (req) => {
    await assertUnlocked();
    const body = z.object({ name: z.string().min(1).max(60) }).parse(req.body);
    const event = await ensureEvent();
    const team = await one(
      `insert into teams (event_id, name, position)
       values ($1, $2, coalesce((select max(position) + 1 from teams where event_id = $1), 0))
       returning *`,
      [event.id, body.name],
    );
    await ensureRuns(event.id);
    return touched({ id: team.id });
  });

  app.patch('/api/admin/teams/:id', async (req) => {
    await assertUnlocked();
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({ name: z.string().min(1).max(60).optional(), position: z.number().int().optional() })
      .parse(req.body);
    await query('update teams set name = coalesce($2, name), position = coalesce($3, position) where id = $1', [
      id,
      body.name ?? null,
      body.position ?? null,
    ]);
    return touched({ ok: true });
  });

  app.delete('/api/admin/teams/:id', async (req) => {
    await assertUnlocked();
    const { id } = z.object({ id: uuid }).parse(req.params);
    await query('delete from teams where id = $1', [id]);
    return touched({ ok: true });
  });

  app.post('/api/admin/teams/:id/members', async (req) => {
    await assertUnlocked();
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({ name: z.string().min(1).max(60), canJudgeForm: z.boolean().default(false) })
      .parse(req.body);
    const member = await one(
      `insert into members (team_id, name, code, can_judge_form, position)
       values ($1, $2, $3, $4, coalesce((select max(position) + 1 from members where team_id = $1), 0))
       returning *`,
      [id, body.name, await uniqueCode(), body.canJudgeForm],
    );
    return touched({ id: member.id, code: member.code });
  });

  app.patch('/api/admin/members/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(1).max(60).optional(),
        canJudgeForm: z.boolean().optional(),
        regenerateCode: z.boolean().optional(),
      })
      .parse(req.body);
    // Un code perdu doit pouvoir etre regenere le jour J : c'est la seule
    // modification d'un participant permise quand la configuration est verrouillee.
    if (body.name !== undefined || body.canJudgeForm !== undefined) await assertUnlocked();
    const code = body.regenerateCode ? await uniqueCode() : null;
    await query(
      `update members set name = coalesce($2, name), can_judge_form = coalesce($3, can_judge_form),
       code = coalesce($4, code) where id = $1`,
      [id, body.name ?? null, body.canJudgeForm ?? null, code],
    );
    return touched({ ok: true, code });
  });

  app.delete('/api/admin/members/:id', async (req) => {
    await assertUnlocked();
    const { id } = z.object({ id: uuid }).parse(req.params);
    await query('delete from members where id = $1', [id]);
    return touched({ ok: true });
  });

  /* ---------------------------------------------------------------- */
  /* Epreuves et variantes                                            */
  /* ---------------------------------------------------------------- */

  app.post('/api/admin/exercises', async (req) => {
    await assertUnlocked();
    const body = z
      .object({ name: z.string().min(1).max(60), targetPoints: z.number().int().min(1).max(100000).default(60) })
      .parse(req.body);
    const event = await ensureEvent();
    const exercise = await one(
      `insert into exercises (event_id, name, target_points, position)
       values ($1, $2, $3, coalesce((select max(position) + 1 from exercises where event_id = $1), 0))
       returning *`,
      [event.id, body.name, body.targetPoints],
    );
    await ensureRuns(event.id);
    return touched({ id: exercise.id });
  });

  app.patch('/api/admin/exercises/:id', async (req) => {
    await assertUnlocked();
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(1).max(60).optional(),
        targetPoints: z.number().int().min(1).max(100000).optional(),
        position: z.number().int().optional(),
        imageId: uuid.nullable().optional(),
      })
      .parse(req.body);
    await query(
      `update exercises set name = coalesce($2, name), target_points = coalesce($3, target_points),
       position = coalesce($4, position) where id = $1`,
      [id, body.name ?? null, body.targetPoints ?? null, body.position ?? null],
    );
    if (body.imageId !== undefined) {
      await query('update exercises set image_id = $2 where id = $1', [id, body.imageId]);
    }
    return touched({ ok: true });
  });

  app.delete('/api/admin/exercises/:id', async (req) => {
    await assertUnlocked();
    const { id } = z.object({ id: uuid }).parse(req.params);
    await query('delete from exercises where id = $1', [id]);
    return touched({ ok: true });
  });

  app.post('/api/admin/exercises/:id/variants', async (req) => {
    await assertUnlocked();
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({ name: z.string().min(1).max(60), points: z.number().int().min(1).max(100).default(1) })
      .parse(req.body);
    const variant = await one(
      `insert into variants (exercise_id, name, points, position)
       values ($1, $2, $3, coalesce((select max(position) + 1 from variants where exercise_id = $1), 0))
       returning *`,
      [id, body.name, body.points],
    );
    return touched({ id: variant.id });
  });

  app.patch('/api/admin/variants/:id', async (req) => {
    await assertUnlocked();
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(1).max(60).optional(),
        points: z.number().int().min(1).max(100).optional(),
        position: z.number().int().optional(),
        imageId: uuid.nullable().optional(),
      })
      .parse(req.body);
    await query(
      `update variants set name = coalesce($2, name), points = coalesce($3, points),
       position = coalesce($4, position) where id = $1`,
      [id, body.name ?? null, body.points ?? null, body.position ?? null],
    );
    if (body.imageId !== undefined) {
      await query('update variants set image_id = $2 where id = $1', [id, body.imageId]);
    }
    return touched({ ok: true });
  });

  app.delete('/api/admin/variants/:id', async (req) => {
    await assertUnlocked();
    const { id } = z.object({ id: uuid }).parse(req.params);
    await query('delete from variants where id = $1', [id]);
    return touched({ ok: true });
  });

  /* ---------------------------------------------------------------- */
  /* Deroulement : series et affectations                             */
  /* ---------------------------------------------------------------- */

  /**
   * Tirage au sort du deroulement : quelles equipes font le workout ensemble,
   * et qui les arbitre. Les series deja terminees sont conservees, et leurs
   * equipes ne sont pas reprogrammees.
   */
  app.post('/api/admin/heats/draw', async (req) => {
    const body = z
      .object({
        groupSize: z.number().int().min(1).max(20).default(3),
        teamIds: z.array(uuid).optional(),
      })
      .parse(req.body);
    const event = await ensureEvent();
    await ensureRuns(event.id);
    const teams = await getTeams(event.id);
    if (teams.length === 0) throw new HttpError(400, 'Aucune équipe à tirer au sort.');

    const done = await query(
      `select h.id, r.team_id from heats h left join runs r on r.heat_id = h.id
       where h.event_id = $1 and h.status = 'done'`,
      [event.id],
    );
    const alreadyPassed = new Set(done.map((d) => d.team_id).filter(Boolean));
    const doneHeats = new Set(done.map((d) => d.id)).size;

    const candidates = (body.teamIds ?? teams.map((t) => t.id)).filter((id) => !alreadyPassed.has(id));
    if (candidates.length === 0) throw new HttpError(400, 'Toutes les équipes sont déjà passées.');

    const drawn = drawHeats({ teams, teamIds: candidates, groupSize: body.groupSize });

    const warnings = await transaction(async (client) => {
      await client.query("delete from heats where event_id = $1 and status <> 'done'", [event.id]);
      const allWarnings: string[] = [];
      for (const [index, heat] of drawn.entries()) {
        const number = doneHeats + index + 1;
        const heatRow = await client.query(
          `insert into heats (event_id, name, position, status)
           values ($1, $2, $3, 'pending') returning id`,
          [event.id, `Série ${number}`, number - 1],
        );
        const heatId = heatRow.rows[0].id as string;

        for (const teamId of heat.teamIds) {
          await client.query('update runs set heat_id = $1 where team_id = $2', [heatId, teamId]);
        }
        for (const a of heat.assignments) {
          const run = await client.query('select id from runs where team_id = $1', [a.teamId]);
          await client.query(
            `insert into assignments (heat_id, run_id, team_id, judge_member_id, role)
             values ($1, $2, $3, $4, $5)`,
            [heatId, run.rows[0].id, a.teamId, a.judgeMemberId, a.role],
          );
        }
        allWarnings.push(...heat.warnings.map((w) => `Série ${number} : ${w}`));
      }
      return allWarnings;
    });

    return touched({ ok: true, heats: drawn.length, warnings });
  });

  app.patch('/api/admin/heats/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({
        status: z.enum(['pending', 'active', 'done']).optional(),
        name: z.string().min(1).max(80).optional(),
        position: z.number().int().optional(),
      })
      .parse(req.body);
    await query(
      `update heats set status = coalesce($2, status), name = coalesce($3, name),
       position = coalesce($4, position) where id = $1`,
      [id, body.status ?? null, body.name ?? null, body.position ?? null],
    );
    return touched({ ok: true });
  });

  app.delete('/api/admin/heats/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await query('delete from heats where id = $1', [id]);
    return touched({ ok: true });
  });

  /** Remplace l'arbitre d'une affectation (echange de derniere minute). */
  app.patch('/api/admin/assignments/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ judgeMemberId: uuid }).parse(req.body);
    const current = await one('select * from assignments where id = $1', [id]);
    const clash = await query(
      'select 1 from assignments where heat_id = $1 and judge_member_id = $2 and id <> $3',
      [current.heat_id, body.judgeMemberId, id],
    );
    if (clash.length > 0) {
      throw new HttpError(409, 'Cette personne arbitre déjà dans cette série.');
    }
    await query('update assignments set judge_member_id = $2 where id = $1', [id, body.judgeMemberId]);
    return touched({ ok: true });
  });

  /** Echange les deux arbitres de deux affectations. */
  app.post('/api/admin/assignments/swap', async (req) => {
    const body = z.object({ a: uuid, b: uuid }).parse(req.body);
    await transaction(async (client) => {
      const rows = await client.query('select * from assignments where id = any($1::uuid[])', [
        [body.a, body.b],
      ]);
      if (rows.rowCount !== 2) throw new HttpError(404, 'Affectation introuvable.');
      const [first, second] = rows.rows;
      // Suppression puis reinsertion : evite de heurter l'unicite (serie, arbitre).
      await client.query('delete from assignments where id = any($1::uuid[])', [[body.a, body.b]]);
      for (const [row, judge] of [
        [first, second.judge_member_id],
        [second, first.judge_member_id],
      ] as const) {
        await client.query(
          `insert into assignments (id, heat_id, run_id, team_id, judge_member_id, role)
           values ($1, $2, $3, $4, $5, $6)`,
          [row.id, row.heat_id, row.run_id, row.team_id, judge, row.role],
        );
      }
    });
    return touched({ ok: true });
  });

  /* ---------------------------------------------------------------- */
  /* Passages                                                         */
  /* ---------------------------------------------------------------- */

  app.post('/api/admin/runs/:id/reset', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await applyTimerAction(id, 'reset', Date.now());
    return touched({ ok: true });
  });

  /* ---------------------------------------------------------------- */
  /* Jeu de demonstration                                             */
  /* ---------------------------------------------------------------- */

  app.post('/api/admin/demo', async () => {
    await assertUnlocked();
    const event = await ensureEvent();
    const existing = await query('select 1 from teams where event_id = $1', [event.id]);
    if (existing.length > 0) throw new HttpError(409, 'Des équipes existent déjà.');

    const teamNames = ['Les Spartiates', 'Team Rocket', 'Les Bisons', 'Alpha Squad', 'Les Titans', 'Kilo Force'];
    const firstNames = ['Alex', 'Sam', 'Chris', 'Jo', 'Max', 'Lou', 'Noa', 'Rémi', 'Eli', 'Théo', 'Inès', 'Manon', 'Yanis', 'Sacha', 'Camille', 'Nino', 'Léna', 'Tom'];
    let n = 0;
    for (const [i, name] of teamNames.entries()) {
      const team = await one('insert into teams (event_id, name, position) values ($1, $2, $3) returning id', [
        event.id,
        name,
        i,
      ]);
      for (let m = 0; m < 3; m++) {
        await query(
          'insert into members (team_id, name, code, can_judge_form, position) values ($1, $2, $3, $4, $5)',
          [team.id, `${firstNames[n % firstNames.length]} ${String.fromCharCode(65 + i)}`, await uniqueCode(), m === 0, m],
        );
        n++;
      }
    }

    const exercises = [
      { name: 'Pompes', target: 60, variants: [['Sur les genoux', 1], ['Pompe complète', 2], ['Pompe claquée', 3]] },
      { name: 'Tractions', target: 60, variants: [['Niveau 1 — anneaux', 1], ['Niveau 2 — assistée', 2], ['Niveau 3 — stricte', 3]] },
      { name: 'Burpees', target: 40, variants: [['Sans pompe', 1], ['Burpee complet', 2]] },
      { name: 'Toes to bar', target: 40, variants: [['Genoux poitrine', 1], ['Toes to bar', 2]] },
    ];
    for (const [i, ex] of exercises.entries()) {
      const row = await one(
        'insert into exercises (event_id, name, target_points, position) values ($1, $2, $3, $4) returning id',
        [event.id, ex.name, ex.target, i],
      );
      for (const [vi, v] of ex.variants.entries()) {
        await query('insert into variants (exercise_id, name, points, position) values ($1, $2, $3, $4)', [
          row.id,
          v[0],
          v[1],
          vi,
        ]);
      }
    }

    await ensureRuns(event.id);
    return touched({ ok: true });
  });

  /** Efface les comptages sans toucher a la configuration. */
  app.post('/api/admin/reset-scores', async () => {
    const event = await ensureEvent();
    await transaction(async (client) => {
      await client.query('delete from ops where run_id in (select id from runs where event_id = $1)', [event.id]);
      await client.query(
        'delete from run_segments where run_id in (select id from runs where event_id = $1)',
        [event.id],
      );
      await client.query(
        `update runs set status = 'pending', finish_ts = null, elapsed_ms = null, reset_at = $2
         where event_id = $1`,
        [event.id, Date.now()],
      );
    });
    return touched({ ok: true });
  });

  app.get('/api/admin/codes', async () => {
    const event = await ensureEvent();
    const teams = await getTeams(event.id);
    return { teams };
  });

}
