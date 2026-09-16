import { buildTrack, computeRunState, EDITION_SCHEMA_VERSION, workoutProgress } from '@ow/shared';
import type { EditionSummary, EditionTeamV1, EditionV1 } from '@ow/shared';
import { one, query, transaction } from './db.ts';
import { HttpError } from './routes.ts';
import {
  EDITION_LOCK,
  ensureEvent,
  ensureRuns,
  getExercises,
  getHeats,
  getOps,
  getTeams,
  recomputeRun,
} from './store.ts';

/**
 * Nom d'edition unique, facon explorateur Windows : « OW 2026 », puis
 * « OW 2026 (1) », « OW 2026 (2) »…
 */
export async function uniqueEditionName(wanted: string): Promise<string> {
  const taken = new Set((await query('select name from editions')).map((r) => r.name as string));
  const name = wanted.trim() || 'Édition';
  if (!taken.has(name)) return name;
  const base = name.replace(/\s\(\d+\)$/, '');
  for (let k = 1; ; k++) {
    const candidate = `${base} (${k})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Lancer une edition : verrouille la configuration et publie les affectations.
 * Les comptages repartent de zero ; le tirage deja fait est conserve.
 */
export async function launchEdition(): Promise<{ name: string }> {
  const event = await ensureEvent();
  if (event.runningSince !== null) throw new HttpError(409, 'Une édition est déjà en cours.');
  await ensureRuns(event.id);

  const name = await uniqueEditionName(event.name);
  const now = Date.now();
  await transaction(async (client) => {
    await client.query('delete from ops where run_id in (select id from runs where event_id = $1)', [event.id]);
    await client.query('delete from run_segments where run_id in (select id from runs where event_id = $1)', [
      event.id,
    ]);
    await client.query(
      `update runs set status = 'pending', finish_ts = null, elapsed_ms = null, reset_at = $2
       where event_id = $1`,
      [event.id, now],
    );
    await client.query('update events set name = $2, running_since = $3 where id = $1', [event.id, name, now]);
  });
  return { name };
}

/**
 * Terminer l'edition : les resultats sont figes dans une edition immuable,
 * puis series et comptages repartent de zero pour la suivante.
 */
export async function finishEdition(): Promise<{ id: string; name: string }> {
  return transaction(async (client) => {
    // Exclusif : plus aucun tap n'est enregistre pendant la cloture.
    await client.query('select pg_advisory_xact_lock($1)', [EDITION_LOCK]);

    const event = await ensureEvent();
    if (event.runningSince === null) throw new HttpError(409, "Aucune édition n'est en cours.");
    await ensureRuns(event.id);

    const [teams, exercises, heats] = await Promise.all([
      getTeams(event.id),
      getExercises(event.id),
      getHeats(event.id),
    ]);
    const runRows = await query('select id, team_id from runs where event_id = $1', [event.id]);
    const endedAt = Date.now();
    const workout = exercises.map((e) => ({ id: e.id, targetPoints: e.targetPoints }));

    const archived: EditionTeamV1[] = [];
    for (const team of teams) {
      const runId = runRows.find((r) => r.team_id === team.id)?.id as string | undefined;
      const snapshot = runId ? await recomputeRun(runId) : null;
      const ops = runId ? await getOps(runId) : [];
      const segments = snapshot?.run.segments ?? [];
      const options = {
        exercises: workout,
        minRepsPerMember: event.minRepsPerMember,
        memberIds: team.members.map((m) => m.id),
        segments,
      };
      const state = snapshot?.state ?? computeRunState([], options);

      archived.push({
        id: team.id,
        name: team.name,
        position: team.position,
        heatName: heats.find((h) => h.teamIds.includes(team.id))?.name ?? null,
        members: team.members.map((m) => ({ id: m.id, name: m.name })),
        result: {
          started: segments.length > 0 || ops.length > 0,
          finished: state.finished,
          elapsedMs: state.finished ? state.elapsedMs : null,
          currentIndex: state.currentIndex,
          progress: workoutProgress(state),
          rank: null,
          splits: exercises.map((e) => state.exercises.find((p) => p.exerciseId === e.id)?.splitMs ?? null),
        },
        track: buildTrack(ops, options),
        raw: { ops, segments },
      });
    }

    // Classement : arrivees au temps, puis les autres a l'avancement.
    archived.sort((a, b) => {
      if (a.result.finished && b.result.finished) return (a.result.elapsedMs ?? 0) - (b.result.elapsedMs ?? 0);
      if (a.result.finished !== b.result.finished) return a.result.finished ? -1 : 1;
      return b.result.progress - a.result.progress;
    });
    let rank = 0;
    for (const team of archived) if (team.result.finished) team.result.rank = ++rank;

    const name = await uniqueEditionName(event.name);
    const edition: EditionV1 = {
      schemaVersion: EDITION_SCHEMA_VERSION,
      name,
      startedAt: event.runningSince,
      endedAt,
      minRepsPerMember: event.minRepsPerMember,
      exercises: exercises.map((e) => ({
        id: e.id,
        name: e.name,
        targetPoints: e.targetPoints,
        position: e.position,
        variants: e.variants.map((v) => ({ id: v.id, name: v.name, points: v.points })),
      })),
      teams: archived,
    };
    const winner = archived[0]?.result.finished ? archived[0] : null;
    const summary = {
      teams: archived.length,
      finished: archived.filter((t) => t.result.finished).length,
      winner: winner?.name ?? null,
      winnerMs: winner?.result.elapsedMs ?? null,
    };

    const inserted = await client.query(
      `insert into editions (name, schema_version, started_at, ended_at, summary, snapshot)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [name, EDITION_SCHEMA_VERSION, event.runningSince, endedAt, JSON.stringify(summary), JSON.stringify(edition)],
    );

    // Remise a neuf pour l'edition suivante. reset_at ecarte aussi, pour toujours,
    // les taps de cette edition encore en attente sur un telephone hors-ligne.
    await client.query('delete from ops where run_id in (select id from runs where event_id = $1)', [event.id]);
    await client.query('delete from run_segments where run_id in (select id from runs where event_id = $1)', [
      event.id,
    ]);
    await client.query('delete from heats where event_id = $1', [event.id]);
    await client.query(
      `update runs set status = 'pending', finish_ts = null, elapsed_ms = null, heat_id = null, reset_at = $2
       where event_id = $1`,
      [event.id, endedAt],
    );
    await client.query('update events set name = $2, running_since = null where id = $1', [event.id, name]);

    return { id: inserted.rows[0].id as string, name };
  });
}

export async function listEditions(): Promise<EditionSummary[]> {
  const rows = await query(
    'select id, name, schema_version, started_at, ended_at, summary from editions order by ended_at desc',
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    schemaVersion: r.schema_version,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    teams: r.summary?.teams ?? 0,
    finished: r.summary?.finished ?? 0,
    winner: r.summary?.winner ?? null,
    winnerMs: r.summary?.winnerMs ?? null,
  }));
}

/** Une edition, sans son journal brut (inutile a l'affichage et volumineux). */
export async function getEdition(id: string): Promise<{ id: string; schemaVersion: number; edition: unknown }> {
  const row = await one('select id, schema_version, snapshot from editions where id = $1', [id]);
  const snapshot = row.snapshot;
  if (Array.isArray(snapshot?.teams)) {
    snapshot.teams = snapshot.teams.map(({ raw: _raw, ...team }: { raw?: unknown }) => team);
  }
  return { id: row.id, schemaVersion: row.schema_version, edition: snapshot };
}
