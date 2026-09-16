import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.ts';

// Les bigint (horodatages epoch ms) doivent revenir en number, pas en string.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T> {
  const rows = await query<T>(text, params);
  const row = rows[0];
  if (!row) throw Object.assign(new Error('Introuvable'), { statusCode: 404 });
  return row;
}

export async function transaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Applique le schema (idempotent) en reessayant : la base peut demarrer apres nous. */
export async function migrate(log: (msg: string) => void): Promise<void> {
  const sql = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');
  const deadline = Date.now() + 60_000;
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(sql);
      log('schema applique');
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      log(`base indisponible (essai ${attempt}), nouvelle tentative dans 2s`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
