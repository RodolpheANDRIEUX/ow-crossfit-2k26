/**
 * Test de bout en bout sur un serveur en marche.
 *
 * Rejoue le scenario du jour J : images des epreuves, tirage au sort des trois
 * postes d'arbitrage, catalogue avant lancement, lancement de l'edition, puis le
 * workout complet d'une equipe — chaque epreuve comptee par l'arbitre compteur
 * et validee par l'arbitre au chrono. Coupure reseau simulee (taps renvoyes en
 * desordre et en double), annulations, cloture et archivage de l'edition,
 * edition suivante au nom dedoublonne.
 *
 * Attention : le test cree deux editions « Test automatique » dans l'historique.
 *
 *   node scripts/smoke.mjs [http://localhost:3000] [CODE_ADMIN]
 */
const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_CODE = process.argv[3] ?? process.env.ADMIN_CODE ?? 'OW2026';
const TEST_NAME = 'Test automatique';

/** Image PNG 1 x 1 transparente. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label} ${detail}`);
  }
};

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return data;
}

/** L'appel doit echouer avec ce statut HTTP. */
const fails = async (status, path, options) => {
  try {
    await call(path, options);
    return false;
  } catch (error) {
    return String(error.message).includes(`-> ${status}`);
  }
};

const uuid = () => crypto.randomUUID();
const send = (ops, token) => call('/api/ops', { method: 'POST', body: { ops }, token });
const snapshotOf = (result, runId) => result.snapshots.find((s) => s.run.id === runId);

console.log(`\n== Compteur OW — test de bout en bout sur ${BASE} ==\n`);

/* 1. Organisation ------------------------------------------------------- */

const { token: adminToken } = await call('/api/auth/admin', {
  method: 'POST',
  body: { code: ADMIN_CODE },
});
const admin = { token: adminToken };
check('connexion organisation', Boolean(adminToken));

try {
  await call('/api/admin/demo', { method: 'POST', ...admin });
  console.log('  ..   jeu de demonstration cree');
} catch {
  console.log('  ..   donnees deja presentes, on reutilise');
}

let state = await call('/api/state', admin);
if (state.event.runningSince !== null) {
  await call('/api/admin/event/finish', { method: 'POST', ...admin });
  console.log('  ..   edition en cours terminee (test precedent interrompu)');
}
await call('/api/admin/reset-scores', { method: 'POST', ...admin });
await call('/api/admin/event', { method: 'PATCH', body: { name: TEST_NAME }, ...admin });

state = await call('/api/state', admin);
const exercises = state.exercises;
check('un workout de plusieurs epreuves', exercises.length >= 2, String(exercises.length));
check('chaque epreuve a ses variantes', exercises.every((e) => e.variants.length > 0));
check('un passage par equipe', state.snapshots.length === state.teams.length);
check('aucune edition en cours', state.event.runningSince === null && state.event.locked === false);

/* 2. Images des epreuves -------------------------------------------------- */

const uploaded = await call('/api/admin/images', { method: 'POST', body: { dataUrl: PNG }, ...admin });
check('image televersee', typeof uploaded.id === 'string');
await call(`/api/admin/exercises/${exercises[0].id}`, { method: 'PATCH', body: { imageId: uploaded.id }, ...admin });
await call(`/api/admin/variants/${exercises[0].variants[0].id}`, {
  method: 'PATCH',
  body: { imageId: uploaded.id },
  ...admin,
});
const withImage = (await call('/api/state', admin)).exercises[0];
check(
  'image rattachee a l epreuve et a la variante',
  withImage.imageId === uploaded.id && withImage.variants[0].imageId === uploaded.id,
);
const imageResponse = await fetch(`${BASE}/api/images/${uploaded.id}`);
check(
  'image servie sans jeton, en cache long',
  imageResponse.status === 200 &&
    (imageResponse.headers.get('content-type') ?? '').startsWith('image/png') &&
    (imageResponse.headers.get('cache-control') ?? '').includes('immutable'),
);
check(
  'un fichier qui n est pas une image est refuse',
  await fails(400, '/api/admin/images', { method: 'POST', body: { dataUrl: 'data:text/plain;base64,aGVsbG8=' }, ...admin }),
);
await call(`/api/admin/exercises/${exercises[0].id}`, { method: 'PATCH', body: { imageId: null }, ...admin });
await call(`/api/admin/variants/${exercises[0].variants[0].id}`, { method: 'PATCH', body: { imageId: null }, ...admin });
const withoutImage = (await call('/api/state', admin)).exercises[0];
check('image retiree', withoutImage.imageId === null && withoutImage.variants[0].imageId === null);

/* 3. Tirage au sort, avant le lancement ---------------------------------- */

const draw = await call('/api/admin/heats/draw', { method: 'POST', body: { groupSize: 3 }, ...admin });
check('tirage au sort effectue', draw.heats > 0, JSON.stringify(draw.warnings));
check('aucune contrainte relachee', draw.warnings.length === 0, JSON.stringify(draw.warnings));

state = await call('/api/state', admin);
const heat = [...state.heats].sort((a, b) => a.position - b.position)[0];
const inHeat = new Set(heat.teamIds);
const everyone = state.teams.flatMap((t) => t.members);
const teamOf = (memberId) => state.teams.find((t) => t.members.some((m) => m.id === memberId));

check('3 equipes dans la premiere serie', heat.teamIds.length === 3, String(heat.teamIds.length));
check(
  'toutes les equipes sont programmees',
  new Set(state.heats.flatMap((h) => h.teamIds)).size === state.teams.length,
);

for (const teamId of heat.teamIds) {
  const posts = heat.assignments.filter((a) => a.teamId === teamId);
  const short = teamId.slice(0, 4);
  check(
    `trois postes pourvus (${short})`,
    JSON.stringify(posts.map((p) => p.role).sort()) === '["counter","form","timer"]',
    JSON.stringify(posts.map((p) => p.role)),
  );
  check(
    `3 equipes d'arbitres differentes (${short})`,
    new Set(posts.map((p) => teamOf(p.judgeMemberId)?.id)).size === 3,
  );
  check(
    `aucun arbitre pris dans une equipe qui passe (${short})`,
    posts.every((p) => !inHeat.has(teamOf(p.judgeMemberId)?.id)),
  );
  const form = posts.find((p) => p.role === 'form');
  check(
    `le juge de forme est habilite (${short})`,
    everyone.find((m) => m.id === form.judgeMemberId)?.canJudgeForm === true,
  );
}

await call(`/api/admin/heats/${heat.id}`, { method: 'PATCH', body: { status: 'active' }, ...admin });

const teamId = heat.teamIds[0];
const team = state.teams.find((t) => t.id === teamId);
const posts = Object.fromEntries(
  heat.assignments.filter((a) => a.teamId === teamId).map((a) => [a.role, a]),
);
const runId = posts.counter.runId;

async function loginAs(assignment) {
  const member = everyone.find((m) => m.id === assignment.judgeMemberId);
  return call('/api/auth/judge', { method: 'POST', body: { memberId: member.id, code: member.code } });
}

const counter = await loginAs(posts.counter);
const timer = await loginAs(posts.timer);
const form = await loginAs(posts.form);
const judges = [counter, timer, form];

const before = await Promise.all(judges.map((j) => call('/api/judge/me', { token: j.token })));
check('avant le lancement : aucune affectation a l ecran', before.every((v) => v.assignment === null));
check('avant le lancement : le catalogue des epreuves est envoye', before[0].exercises?.length === exercises.length);

const early = await send(
  [{ id: uuid(), runId, type: 'rep', variantId: exercises[0].variants[0].id, clientTs: Date.now() }],
  counter.token,
);
check(
  'avant le lancement : aucun tap n est compte',
  early.accepted.length === 0 && (early.rejected[0]?.reason ?? '').includes('lanc'),
  JSON.stringify(early.rejected),
);
check(
  'avant le lancement : le chrono ne demarre pas',
  await fails(409, `/api/runs/${runId}/timer`, { method: 'POST', body: { action: 'start' }, token: timer.token }),
);

/* 4. Lancement de l'edition --------------------------------------------- */

const launched = await call('/api/admin/event/launch', { method: 'POST', ...admin });
check('lancement : nom de l edition', /^Test automatique( \(\d+\))?$/.test(launched.name), launched.name);
state = await call('/api/state', admin);
check('lancement : edition en cours, configuration verrouillee', typeof state.event.runningSince === 'number' && state.event.locked);
check('lancement : un deuxieme lancement est refuse', await fails(409, '/api/admin/event/launch', { method: 'POST', ...admin }));

const lockedExercise = state.exercises[0];
const lockedMember = state.teams[0].members[0];
check(
  'verrouille : objectif de points refuse',
  await fails(409, `/api/admin/exercises/${lockedExercise.id}`, { method: 'PATCH', body: { targetPoints: 99 }, ...admin }),
);
check(
  'verrouille : ordre des epreuves refuse',
  await fails(409, `/api/admin/exercises/${lockedExercise.id}`, { method: 'PATCH', body: { position: 99 }, ...admin }),
);
check(
  'verrouille : points d une variante refuses',
  await fails(409, `/api/admin/variants/${lockedExercise.variants[0].id}`, { method: 'PATCH', body: { points: 9 }, ...admin }),
);
check(
  'verrouille : minimum de reps refuse',
  await fails(409, '/api/admin/event', { method: 'PATCH', body: { minRepsPerMember: 7 }, ...admin }),
);
check(
  'verrouille : nom de l edition fige',
  await fails(409, '/api/admin/event', { method: 'PATCH', body: { name: 'Autre nom' }, ...admin }),
);
check(
  'verrouille : habilitation forme refusee',
  await fails(409, `/api/admin/members/${lockedMember.id}`, {
    method: 'PATCH',
    body: { canJudgeForm: !lockedMember.canJudgeForm },
    ...admin,
  }),
);
const regenerated = await call(`/api/admin/members/${lockedMember.id}`, {
  method: 'PATCH',
  body: { regenerateCode: true },
  ...admin,
});
check('verrouille : regenerer un code reste possible', typeof regenerated.code === 'string');

const views = await Promise.all(judges.map((j) => call('/api/judge/me', { token: j.token })));
check('lancee : le compteur voit son affectation', views[0].assignment?.run.id === runId);
check(
  'lancee : chaque arbitre recoit son poste',
  views.map((v) => v.assignment?.assignment.role).join() === 'counter,timer,form',
);
check('lancee : l arbitre recoit tout le workout', views[0].assignment?.exercises.length === exercises.length);

/* 5. Depart du chrono ---------------------------------------------------- */

// Horloge simulee : les horodatages doivent rester coherents entre eux, sinon
// une action « plus tard » retomberait avant les repetitions deja comptees.
const T0 = Date.now();
let clock = T0;
const at = (delta = 500) => (clock += delta);
await call(`/api/runs/${runId}/timer`, { method: 'POST', body: { action: 'start', at: T0 }, token: timer.token });

/* 6. Le workout complet, epreuve apres epreuve --------------------------- */

const allOps = [];
let firstReps = [];
let lastValidations = [];
let last = null;

for (const [k, exercise] of exercises.entries()) {
  const variant = exercise.variants[exercise.variants.length - 1];
  const reps = [];
  while (reps.length * variant.points < exercise.targetPoints) {
    reps.push({ id: uuid(), runId, type: 'rep', variantId: variant.id, clientTs: at(700) });
  }

  if (k === 0) {
    // Premiere epreuve : envoi en desordre, en deux lots qui se recouvrent.
    firstReps = reps;
    const shuffled = [...reps].sort(() => Math.random() - 0.5);
    await send(shuffled.slice(0, 5), counter.token);
  }
  const counted = snapshotOf(await send(reps, counter.token), runId);
  const progress = counted.state.exercises[k];
  check(`${exercise.name} : score exact`, progress.score === reps.length * variant.points, `${progress.score}`);
  check(
    `${exercise.name} : points atteints, epreuve pas encore validee`,
    progress.pointsReached && progress.completedAt === null && counted.state.currentIndex === k,
  );

  const validations = team.members.map((member) => ({
    id: uuid(),
    runId,
    type: 'min',
    exerciseId: exercise.id,
    memberId: member.id,
    clientTs: at(1000),
  }));
  const validated = snapshotOf(await send(validations, timer.token), runId);
  check(
    `${exercise.name} : validee a la derniere case cochee`,
    validated.state.exercises[k].completedAt === validations[validations.length - 1].clientTs,
  );
  check(
    `${exercise.name} : on enchaine sur la suivante`,
    validated.state.currentIndex === k + 1,
    String(validated.state.currentIndex),
  );

  allOps.push(...reps, ...validations);
  lastValidations = validations;
  last = validated;
}

const finishTs = last.state.finishTs;
check('workout termine apres la derniere epreuve', last.state.finished);
check('le chrono s arrete tout seul', last.run.status === 'finished', last.run.status);
check('temps fige a la validation de la derniere epreuve', finishTs === clock);
check('temps total = chrono ecoule', last.state.elapsedMs === finishTs - T0);
check(
  'somme des temps intermediaires = temps total',
  last.state.exercises.reduce((sum, e) => sum + e.splitMs, 0) === last.state.elapsedMs,
);

/* 7. Idempotence --------------------------------------------------------- */

const replay = snapshotOf(await send(allOps, counter.token), runId);
check('renvoi complet sans doublon', replay.state.exercises.every((e, i) => e.score === last.state.exercises[i].score));
check('temps officiel inchange', replay.state.finishTs === finishTs);

/* 8. Annulation d'une rep de la premiere epreuve, apres coup ------------- */

const undone = snapshotOf(
  await send(
    [{ id: uuid(), runId, type: 'undo', targetOpId: firstReps[firstReps.length - 1].id, clientTs: at() }],
    counter.token,
  ),
  runId,
);
check('la premiere epreuve redevient en cours', undone.state.currentIndex === 0);
check('les epreuves suivantes ne sont plus validees', undone.state.exercises.slice(1).every((e) => e.completedAt === null));
check('le workout n est plus termine, le chrono repart', !undone.state.finished && undone.run.status === 'running', undone.run.status);

const recount = { id: uuid(), runId, type: 'rep', variantId: exercises[0].variants.at(-1).id, clientTs: at() };
const recounted = snapshotOf(await send([recount], counter.token), runId);
check('rep recomptee : tout se revalide', recounted.state.finished);
check('au nouvel instant', recounted.state.finishTs === recount.clientTs);

/* 9. Un minimum decoche sur la derniere epreuve -------------------------- */

const unchecked = snapshotOf(
  await send([{ id: uuid(), runId, type: 'undo', targetOpId: lastValidations[1].id, clientTs: at() }], timer.token),
  runId,
);
check('decocher un minimum invalide la derniere epreuve', !unchecked.state.finished);
check('on revient sur cette epreuve', unchecked.state.currentIndex === exercises.length - 1);

const recheck = {
  id: uuid(),
  runId,
  type: 'min',
  exerciseId: exercises[exercises.length - 1].id,
  memberId: team.members[1].id,
  clientTs: at(),
};
const rechecked = snapshotOf(await send([recheck], timer.token), runId);
check('recocher revalide le workout', rechecked.state.finished);
check('avec le temps de la nouvelle validation', rechecked.state.finishTs === recheck.clientTs);

/* 10. Robustesse de la file d'attente ------------------------------------ */

const orphan = { id: uuid(), runId: uuid(), type: 'rep', variantId: exercises[0].variants[0].id, clientTs: at() };
const noExercise = { id: uuid(), runId, type: 'min', memberId: team.members[0].id, clientTs: at() };
const valid = { id: uuid(), runId, type: 'rep', variantId: exercises[1].variants[0].id, clientTs: T0 + 200 };
const mixed = await send([orphan, noExercise, valid], counter.token);
check(
  'un tap sur un passage disparu est refuse sans bloquer le lot',
  mixed.rejected.some((r) => r.id === orphan.id) && mixed.accepted.includes(valid.id),
  JSON.stringify(mixed.rejected),
);
check('une validation sans epreuve est refusee', mixed.rejected.some((r) => r.id === noExercise.id));
const storedValid = mixed.ops.find((o) => o.id === valid.id);
check(
  'la reponse renvoie l operation telle qu enregistree (epreuve et points relus en base)',
  storedValid?.exerciseId === exercises[1].id && storedValid?.points === exercises[1].variants[0].points,
  JSON.stringify(storedValid),
);
check(
  'un tap hors-ligne tardif est integre sans perte',
  snapshotOf(mixed, runId).state.exercises[1].score === rechecked.state.exercises[1].score + exercises[1].variants[0].points,
);

/* 11. Cloture de l'edition ----------------------------------------------- */

const beforeFinish = (await call('/api/state', admin)).snapshots.find((s) => s.run.id === runId);
const closed = await call('/api/admin/event/finish', { method: 'POST', ...admin });
check('cloture : l edition garde son nom', closed.name === launched.name, closed.name);

const list = await call('/api/admin/editions', admin);
check('cloture : l edition entre dans l historique', list.editions.some((e) => e.id === closed.id));

const detail = await call(`/api/admin/editions/${closed.id}`, admin);
const archived = detail.edition.teams.find((t) => t.id === teamId);
const lastPoint = archived.track[archived.track.length - 1];
check('edition : format versionne', detail.schemaVersion === 1 && detail.edition.schemaVersion === 1);
check(
  'edition : equipes et epreuves recopiees',
  detail.edition.teams.length === state.teams.length && detail.edition.exercises.length === exercises.length,
);
check(
  'edition : resultat fige identique au live',
  archived.result.finished === true && archived.result.elapsedMs === beforeFinish.state.elapsedMs,
  `${archived.result.elapsedMs} vs ${beforeFinish.state.elapsedMs}`,
);
check('edition : l equipe arrivee est classee premiere', archived.result.rank === 1);
check(
  'edition : le trace de course arrive au temps officiel',
  lastPoint[1] === 1 && lastPoint[0] === beforeFinish.state.elapsedMs,
  JSON.stringify(lastPoint),
);
check('edition : le journal brut n est pas expose', !('raw' in archived));

const after = await call('/api/state', admin);
check(
  'apres cloture : series et comptages remis a zero',
  after.event.runningSince === null &&
    after.heats.length === 0 &&
    after.snapshots.every((s) => s.state.exercises.every((e) => e.score === 0)),
);
const tooLate = await send(
  [{ id: uuid(), runId, type: 'rep', variantId: exercises[0].variants[0].id, clientTs: at() }],
  counter.token,
);
check('apres cloture : un tap en retard est refuse', tooLate.accepted.length === 0);
const backToCatalog = await call('/api/judge/me', { token: counter.token });
check('apres cloture : retour au catalogue', backToCatalog.assignment === null && backToCatalog.event.runningSince === null);

/* 12. Edition suivante : nom dedoublonne --------------------------------- */

const second = await call('/api/admin/event/launch', { method: 'POST', ...admin });
check(
  'nouvelle edition : nom dedoublonne a la Windows',
  second.name !== launched.name && /^Test automatique \(\d+\)$/.test(second.name),
  second.name,
);

/* 13. Remise a zero d'un passage ----------------------------------------- */

await call(`/api/admin/runs/${runId}/reset`, { method: 'POST', ...admin });
const stale = {
  id: uuid(),
  runId,
  type: 'rep',
  variantId: exercises[0].variants[0].id,
  clientTs: Date.now() - 60_000, // tape avant la remise a zero, synchronise apres
};
const afterReset = await send([stale], counter.token);
check(
  'un tap anterieur a la remise a zero est refuse',
  afterReset.rejected.some((r) => r.id === stale.id),
  JSON.stringify(afterReset.rejected),
);
const resetSnapshot = (await call('/api/state', admin)).snapshots.find((s) => s.run.id === runId);
check(
  'le passage remis a zero repart de rien et le signale aux telephones',
  resetSnapshot.state.exercises.every((e) => e.score === 0) && typeof resetSnapshot.run.resetAt === 'number',
);

/* 14. Temps reel --------------------------------------------------------- */

const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws?token=${timer.token}`);
const probe = { id: uuid(), runId, type: 'rep', variantId: exercises[0].variants[0].id, clientTs: at() };
const received = await new Promise((resolve) => {
  const got = { ops: null, snapshot: null };
  const timeout = setTimeout(() => resolve(got), 5000);
  ws.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'hello') await send([probe], counter.token);
    if (message.type === 'ops' && message.ops.some((o) => o.id === probe.id)) got.ops = message;
    if (message.type === 'run' && message.snapshot.run.id === runId && got.ops) {
      got.snapshot = message.snapshot;
      clearTimeout(timeout);
      resolve(got);
    }
  };
});
ws.close();
check('les taps du compteur sont diffuses aux autres arbitres', received.ops !== null);
check('le journal arrive avant la photo du passage', received.snapshot !== null);

/* 15. Cloture de la seconde edition -------------------------------------- */

const closedSecond = await call('/api/admin/event/finish', { method: 'POST', ...admin });
const finalList = await call('/api/admin/editions', admin);
check(
  'les deux editions sont conservees',
  [closed.id, closedSecond.id].every((id) => finalList.editions.some((e) => e.id === id)),
);

console.log(`\n${failures === 0 ? 'TOUT EST VERT' : `${failures} VERIFICATION(S) EN ECHEC`}\n`);
process.exit(failures === 0 ? 0 : 1);
