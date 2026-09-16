import { computeRunState, elapsedAt } from '@ow/shared';
import type {
  Assignment,
  EventConfig,
  Exercise,
  Heat,
  Member,
  Op,
  Run,
  RunSnapshot,
  RunStatus,
  Segment,
  Team,
} from '@ow/shared';
import { query, one, transaction } from './db.ts';
import { broadcast } from './realtime.ts';

/**
 * Verrou applicatif (advisory lock PostgreSQL) entre l'ingestion des taps
 * (partage) et la cloture d'une edition (exclusif).
 */
export const EDITION_LOCK = 4242;

/* ------------------------------------------------------------------ */
/* Evenement                                                           */
/* ------------------------------------------------------------------ */

export async function ensureEvent(): Promise<EventConfig> {
  const rows = await query('select * from events order by created_at limit 1');
  const row =
    rows[0] ??
    (await one("insert into events (name) values ('Olympic Warriors') returning *"));
  return mapEvent(row);
}

function mapEvent(r: any): EventConfig {
  return {
    id: r.id,
    name: r.name,
    runningSince: r.running_since ?? null,
    locked: r.running_since != null,
    teamSize: r.team_size,
    minRepsPerMember: r.min_reps_per_member,
  };
}

/* ------------------------------------------------------------------ */
/* Lecture de la configuration                                         */
/* ------------------------------------------------------------------ */

export async function getTeams(eventId: string): Promise<Team[]> {
  const teams = await query('select * from teams where event_id = $1 order by position, name', [
    eventId,
  ]);
  const members = await query(
    `select m.* from members m join teams t on t.id = m.team_id
     where t.event_id = $1 order by m.position, m.name`,
    [eventId],
  );
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    position: t.position,
    members: members.filter((m) => m.team_id === t.id).map(mapMember),
  }));
}

function mapMember(m: any): Member {
  return {
    id: m.id,
    teamId: m.team_id,
    name: m.name,
    code: m.code,
    canJudgeForm: m.can_judge_form,
    position: m.position,
  };
}

/** Les epreuves du workout, dans l'ordre ou elles s'enchainent. */
export async function getExercises(eventId: string): Promise<Exercise[]> {
  const exercises = await query(
    'select * from exercises where event_id = $1 order by position, name',
    [eventId],
  );
  const variants = await query(
    `select v.* from variants v join exercises e on e.id = v.exercise_id
     where e.event_id = $1 order by v.position, v.points`,
    [eventId],
  );
  return exercises.map((e) => ({
    id: e.id,
    name: e.name,
    targetPoints: e.target_points,
    position: e.position,
    imageId: e.image_id ?? null,
    variants: variants
      .filter((v) => v.exercise_id === e.id)
      .map((v) => ({
        id: v.id,
        exerciseId: v.exercise_id,
        name: v.name,
        points: v.points,
        position: v.position,
        imageId: v.image_id ?? null,
      })),
  }));
}

export async function getHeats(eventId: string): Promise<Heat[]> {
  const heats = await query('select * from heats where event_id = $1 order by position, name', [
    eventId,
  ]);
  // Ordre des equipes fige sur celui de la liste des equipes : sans tri, les
  // colonnes du suivi en direct changeraient de place d'un rafraichissement a
  // l'autre.
  const runs = await query(
    `select r.id, r.team_id, r.heat_id from runs r
     join teams t on t.id = r.team_id
     where r.event_id = $1 and r.heat_id is not null
     order by t.position, t.name`,
    [eventId],
  );
  const assignments = await query(
    'select a.* from assignments a join heats h on h.id = a.heat_id where h.event_id = $1',
    [eventId],
  );
  return heats.map((h) => ({
    id: h.id,
    eventId: h.event_id,
    name: h.name,
    position: h.position,
    status: h.status,
    teamIds: runs.filter((r) => r.heat_id === h.id).map((r) => r.team_id),
    assignments: assignments.filter((a) => a.heat_id === h.id).map(mapAssignment),
  }));
}

function mapAssignment(a: any): Assignment {
  return {
    id: a.id,
    heatId: a.heat_id,
    runId: a.run_id,
    teamId: a.team_id,
    judgeMemberId: a.judge_member_id,
    role: a.role,
  };
}

/* ------------------------------------------------------------------ */
/* Passages                                                            */
/* ------------------------------------------------------------------ */

function mapRun(r: any, segments: Segment[]): Run {
  return {
    id: r.id,
    eventId: r.event_id,
    teamId: r.team_id,
    heatId: r.heat_id,
    status: r.status,
    segments,
    finishedAt: r.finish_ts,
    elapsedMs: r.elapsed_ms,
    resetAt: r.reset_at ?? null,
  };
}

/** Un passage par equipe : le workout complet, sous un seul chrono. */
export async function ensureRuns(eventId: string): Promise<void> {
  await query(
    `insert into runs (event_id, team_id)
     select $1, t.id from teams t where t.event_id = $1
     on conflict (team_id) do nothing`,
    [eventId],
  );
}

async function loadSegments(runId: string): Promise<Segment[]> {
  const rows = await query(
    'select started_at, ended_at from run_segments where run_id = $1 order by started_at',
    [runId],
  );
  return rows.map((r) => ({ startedAt: r.started_at, endedAt: r.ended_at }));
}

function mapOp(o: any): Op {
  return {
    id: o.id,
    runId: o.run_id,
    type: o.type,
    exerciseId: o.exercise_id,
    memberId: o.member_id,
    variantId: o.variant_id,
    points: o.points,
    clientTs: o.client_ts,
    targetOpId: o.target_op_id,
    judgeMemberId: o.judge_member_id,
  };
}

export async function getOpsByIds(ids: string[]): Promise<Op[]> {
  if (ids.length === 0) return [];
  const rows = await query('select * from ops where id = any($1::uuid[]) order by client_ts, id', [ids]);
  return rows.map(mapOp);
}

export async function getOps(runId: string): Promise<Op[]> {
  const rows = await query('select * from ops where run_id = $1 order by client_ts, id', [runId]);
  return rows.map(mapOp);
}

/**
 * Recalcule integralement l'etat du workout d'une equipe depuis son journal
 * d'operations, persiste le resultat et renvoie la photo a diffuser.
 *
 * Toujours reconstruit de zero : rejouable a l'infini, insensible a l'ordre
 * d'arrivee des taps, donc juste meme apres une resynchronisation tardive.
 */
export async function recomputeRun(runId: string): Promise<RunSnapshot> {
  const run = await one('select * from runs where id = $1', [runId]);
  const event = await one('select * from events where id = $1', [run.event_id]);
  const exercises = await query(
    'select id, target_points from exercises where event_id = $1 order by position, name',
    [run.event_id],
  );
  const memberRows = await query('select id from members where team_id = $1 order by position, name', [
    run.team_id,
  ]);
  const ops = await getOps(runId);
  let segments = await loadSegments(runId);

  const state = computeRunState(ops, {
    exercises: exercises.map((e) => ({ id: e.id, targetPoints: e.target_points })),
    minRepsPerMember: event.min_reps_per_member,
    memberIds: memberRows.map((m) => m.id),
    segments,
  });

  segments = await syncSegments(runId, segments, run.finish_ts, state.finishTs);

  const status: RunStatus = state.finished
    ? 'finished'
    : segments.some((s) => s.endedAt === null)
      ? 'running'
      : segments.length > 0
        ? 'paused'
        : 'pending';

  const elapsed = state.finishTs === null ? null : elapsedAt(segments, state.finishTs);

  await query('update runs set status = $2, finish_ts = $3, elapsed_ms = $4 where id = $1', [
    runId,
    status,
    state.finishTs,
    elapsed,
  ]);

  return {
    run: mapRun({ ...run, status, finish_ts: state.finishTs, elapsed_ms: elapsed }, segments),
    state: { ...state, elapsedMs: elapsed },
    serverNow: Date.now(),
  };
}

/**
 * Aligne le chrono sur l'instant de validation de la derniere epreuve.
 *
 * Le chrono s'arrete tout seul quand le workout est valide ; si une annulation
 * ou une rep hors-ligne tardive deplace (ou supprime) cet instant, on recale ou
 * on rouvre le segment pour que le temps officiel reste juste.
 */
async function syncSegments(
  runId: string,
  segments: Segment[],
  previousFinishTs: number | null,
  finishTs: number | null,
): Promise<Segment[]> {
  const last = segments[segments.length - 1];
  if (!last) return segments;
  const withLastEnd = (endedAt: number | null) =>
    segments.map((s, i) => (i === segments.length - 1 ? { ...s, endedAt } : s));

  if (finishTs !== null) {
    const autoClosed = last.endedAt !== null && last.endedAt === previousFinishTs;
    if ((last.endedAt === null && last.startedAt <= finishTs) || (autoClosed && last.endedAt !== finishTs)) {
      await closeLastSegment(runId, finishTs);
      return withLastEnd(finishTs);
    }
    return segments;
  }

  // Le workout n'est plus valide (annulation) : on relance le chrono la ou il avait ete coupe.
  if (previousFinishTs !== null && last.endedAt === previousFinishTs) {
    await closeLastSegment(runId, null);
    return withLastEnd(null);
  }
  return segments;
}

async function closeLastSegment(runId: string, endedAt: number | null): Promise<void> {
  await query(
    `update run_segments set ended_at = $2 where id =
       (select id from run_segments where run_id = $1 order by started_at desc limit 1)`,
    [runId, endedAt],
  );
}

/** Recalcule puis diffuse a tous les appareils connectes. */
export async function publishRun(runId: string): Promise<RunSnapshot> {
  const snapshot = await recomputeRun(runId);
  broadcast({ type: 'run', snapshot });
  return snapshot;
}

export async function getSnapshots(eventId: string): Promise<RunSnapshot[]> {
  const runs = await query('select id from runs where event_id = $1', [eventId]);
  const out: RunSnapshot[] = [];
  for (const r of runs) out.push(await recomputeRun(r.id));
  return out;
}

/* ------------------------------------------------------------------ */
/* Ingestion des operations de comptage                                */
/* ------------------------------------------------------------------ */

export interface IncomingOp {
  id: string;
  runId: string;
  type: 'rep' | 'undo' | 'min';
  exerciseId?: string | null;
  memberId?: string | null;
  variantId?: string | null;
  clientTs: number;
  targetOpId?: string | null;
}

export interface IngestResult {
  accepted: string[];
  rejected: { id: string; reason: string }[];
  runIds: string[];
}

/**
 * Enregistre un lot de taps.
 *
 * - l'identifiant vient du client : un renvoi apres coupure reseau ne cree
 *   jamais de doublon (`on conflict do nothing`) ;
 * - pour une repetition, les points ET l'epreuve sont relus en base a partir
 *   de la variante, jamais pris dans la requete ;
 * - l'horodatage client est conserve tel quel : c'est lui qui fait foi.
 */
export async function ingestOps(
  ops: IncomingOp[],
  judgeMemberId: string | null,
): Promise<IngestResult> {
  const accepted: string[] = [];
  const rejected: { id: string; reason: string }[] = [];
  const runIds = new Set<string>();

  const variantIds = [...new Set(ops.map((o) => o.variantId).filter(Boolean))] as string[];
  const variants = variantIds.length
    ? await query('select id, points, exercise_id from variants where id = any($1::uuid[])', [
        variantIds,
      ])
    : [];
  const variantById = new Map(
    variants.map((v) => [v.id as string, { points: v.points as number, exerciseId: v.exercise_id as string }]),
  );

  const exerciseIds = [...new Set(ops.map((o) => o.exerciseId).filter(Boolean))] as string[];
  const knownExercises = new Set(
    exerciseIds.length
      ? (await query('select id from exercises where id = any($1::uuid[])', [exerciseIds])).map(
          (e) => e.id as string,
        )
      : [],
  );

  const runsInBatch = [...new Set(ops.map((o) => o.runId))];
  const knownRuns = new Map<string, number | null>(
    (await query('select id, reset_at from runs where id = any($1::uuid[])', [runsInBatch])).map((r) => [
      r.id as string,
      (r.reset_at as number | null) ?? null,
    ]),
  );

  let launched = true;
  await transaction(async (client) => {
    // Verrou partage avec la cloture d'une edition : un lot entre entierement
    // dans l'edition, ou il est refuse. Rien ne se glisse entre la photo des
    // resultats et la remise a zero.
    await client.query('select pg_advisory_xact_lock_shared($1)', [EDITION_LOCK]);
    const event = await client.query('select running_since from events order by created_at limit 1');
    if (event.rows[0]?.running_since == null) {
      launched = false;
      return;
    }

    for (const op of ops) {
      if (!knownRuns.has(op.runId)) {
        // Passage supprime entre-temps (equipe retiree, base migree) : on refuse
        // ce tap explicitement. Le laisser echouer ferait echouer tout le lot, et
        // la file d'attente du telephone resterait bloquee pour toujours.
        rejected.push({ id: op.id, reason: 'passage inconnu' });
        continue;
      }
      const resetAt = knownRuns.get(op.runId) ?? null;
      if (resetAt !== null && op.clientTs < resetAt) {
        // Tap fait avant une remise a zero, arrive apres (telephone reste
        // hors-ligne) : la remise a zero l'emporte, comme sur les telephones.
        rejected.push({ id: op.id, reason: 'antérieur à la remise à zéro' });
        continue;
      }
      if (op.type === 'rep') {
        const variant = op.variantId ? variantById.get(op.variantId) : undefined;
        if (!variant) {
          rejected.push({ id: op.id, reason: 'variante inconnue' });
          continue;
        }
        await client.query(
          `insert into ops (id, run_id, type, exercise_id, variant_id, points, client_ts, judge_member_id)
           values ($1, $2, 'rep', $3, $4, $5, $6, $7) on conflict (id) do nothing`,
          [op.id, op.runId, variant.exerciseId, op.variantId, variant.points, op.clientTs, judgeMemberId],
        );
      } else if (op.type === 'min') {
        if (!op.memberId || !op.exerciseId) {
          rejected.push({ id: op.id, reason: 'validation sans membre ou sans épreuve' });
          continue;
        }
        if (!knownExercises.has(op.exerciseId)) {
          rejected.push({ id: op.id, reason: 'épreuve inconnue' });
          continue;
        }
        await client.query(
          `insert into ops (id, run_id, type, exercise_id, member_id, client_ts, judge_member_id)
           values ($1, $2, 'min', $3, $4, $5, $6) on conflict (id) do nothing`,
          [op.id, op.runId, op.exerciseId, op.memberId, op.clientTs, judgeMemberId],
        );
      } else {
        if (!op.targetOpId) {
          rejected.push({ id: op.id, reason: 'annulation sans cible' });
          continue;
        }
        await client.query(
          `insert into ops (id, run_id, type, client_ts, target_op_id, judge_member_id)
           values ($1, $2, 'undo', $3, $4, $5) on conflict (id) do nothing`,
          [op.id, op.runId, op.clientTs, op.targetOpId, judgeMemberId],
        );
      }
      accepted.push(op.id);
      runIds.add(op.runId);
    }
  });

  if (!launched) {
    // Hors edition, rien ne compte : les taps d'une edition terminee (telephone
    // reste hors-ligne) ne doivent pas se glisser dans la suivante.
    return {
      accepted: [],
      rejected: ops.map((op) => ({ id: op.id, reason: "l'édition n'est pas lancée" })),
      runIds: [],
    };
  }
  return { accepted, rejected, runIds: [...runIds] };
}

/* ------------------------------------------------------------------ */
/* Chrono                                                              */
/* ------------------------------------------------------------------ */

export type TimerAction = 'start' | 'pause' | 'resume' | 'reset';

export async function applyTimerAction(
  runId: string,
  action: TimerAction,
  at: number,
): Promise<RunSnapshot> {
  const segments = await loadSegments(runId);
  const open = segments.find((s) => s.endedAt === null);

  if (action === 'reset') {
    await query('delete from run_segments where run_id = $1', [runId]);
    await query('delete from ops where run_id = $1', [runId]);
    await query(
      "update runs set status = 'pending', finish_ts = null, elapsed_ms = null, reset_at = $2 where id = $1",
      [runId, at],
    );
  } else if (action === 'pause') {
    if (open) await closeLastSegment(runId, at);
  } else if (!open) {
    // start et resume sont volontairement identiques : un seul geste a retenir.
    await query('insert into run_segments (run_id, started_at) values ($1, $2)', [runId, at]);
  }

  return publishRun(runId);
}
