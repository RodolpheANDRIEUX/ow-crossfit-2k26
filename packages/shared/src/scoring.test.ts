import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRunState, elapsedAt, formatChrono } from './scoring.ts';
import type { Op } from './types.ts';

const MEMBERS = ['m1', 'm2', 'm3'];
const T0 = 1_700_000_000_000;

/** Workout de test : A (10 points) puis B (6 points). */
const base = {
  exercises: [
    { id: 'A', targetPoints: 10 },
    { id: 'B', targetPoints: 6 },
  ],
  minRepsPerMember: 5,
  memberIds: MEMBERS,
  segments: [{ startedAt: T0, endedAt: null }],
};

const op = (partial: Partial<Op> & Pick<Op, 'id' | 'type' | 'clientTs'>): Op => ({
  runId: 'r1',
  exerciseId: null,
  memberId: null,
  variantId: null,
  points: 0,
  targetOpId: null,
  judgeMemberId: null,
  ...partial,
});

const rep = (id: string, exerciseId: string, points: number, offset: number) =>
  op({ id, type: 'rep', exerciseId, variantId: `v-${exerciseId}`, points, clientTs: T0 + offset });

const min = (id: string, exerciseId: string, memberId: string, offset: number) =>
  op({ id, type: 'min', exerciseId, memberId, clientTs: T0 + offset });

const undo = (id: string, targetOpId: string, offset: number) =>
  op({ id, type: 'undo', targetOpId, clientTs: T0 + offset });

/** Les trois minimums d'une epreuve, valides a partir de `offset`. */
const mins = (exerciseId: string, offset: number) =>
  MEMBERS.map((m, i) => min(`min-${exerciseId}-${m}`, exerciseId, m, offset + i));

test('chaque epreuve a son propre score', () => {
  const s = computeRunState([rep('a1', 'A', 3, 100), rep('b1', 'B', 2, 200)], base);
  assert.equal(s.exercises[0]?.score, 3);
  assert.equal(s.exercises[1]?.score, 2);
  assert.equal(s.currentIndex, 0);
  assert.equal(s.finished, false);
});

test('une epreuve est validee a la rep decisive si les minimums sont deja coches', () => {
  const s = computeRunState([...mins('A', 10), rep('a1', 'A', 6, 1000), rep('a2', 'A', 4, 2000)], base);
  assert.equal(s.exercises[0]?.completedAt, T0 + 2000);
  assert.equal(s.currentIndex, 1, 'on passe a l epreuve suivante');
});

test('si les minimums arrivent apres les points, l epreuve est validee a la derniere case', () => {
  const s = computeRunState([rep('a1', 'A', 10, 1000), ...mins('A', 3000)], base);
  assert.equal(s.exercises[0]?.completedAt, T0 + 3002);
});

test('points atteints sans minimums : l epreuve reste en cours', () => {
  const s = computeRunState([rep('a1', 'A', 12, 1000), min('x', 'A', 'm1', 1500)], base);
  assert.equal(s.exercises[0]?.pointsReached, true);
  assert.equal(s.exercises[0]?.minimumsComplete, false);
  assert.equal(s.exercises[0]?.completedAt, null);
  assert.equal(s.currentIndex, 0);
});

test('le workout se termine a la validation de la derniere epreuve', () => {
  const ops = [
    rep('a1', 'A', 10, 4000),
    ...mins('A', 5000), // A validee a +5002
    rep('b1', 'B', 6, 9000),
    ...mins('B', 12000), // B validee a +12002
  ];
  const s = computeRunState(ops, base);
  assert.equal(s.finished, true);
  assert.equal(s.currentIndex, 2);
  assert.equal(s.finishTs, T0 + 12002);
  assert.equal(s.elapsedMs, 12002);
  assert.equal(s.exercises[0]?.splitMs, 5002);
  assert.equal(s.exercises[1]?.splitMs, 7000);
  assert.equal(
    (s.exercises[0]?.splitMs ?? 0) + (s.exercises[1]?.splitMs ?? 0),
    s.elapsedMs,
    'la somme des temps intermediaires egale le temps total',
  );
});

test('une epreuve ne peut pas etre validee avant la precedente', () => {
  // B entierement faite, mais un minimum manque sur A
  const ops = [rep('a1', 'A', 10, 1000), min('x1', 'A', 'm1', 1100), min('x2', 'A', 'm2', 1200), rep('b1', 'B', 6, 2000), ...mins('B', 2100)];
  const s = computeRunState(ops, base);
  assert.equal(s.exercises[0]?.completedAt, null);
  assert.equal(s.exercises[1]?.completedAt, null, 'B attend A');
  assert.equal(s.currentIndex, 0);
  assert.equal(s.finished, false);
});

test('une validation tardive de A ne rend jamais negatif le temps de B', () => {
  // B satisfaite a +2102, mais le dernier minimum de A n'est coche qu'a +5000
  const ops = [
    rep('a1', 'A', 10, 1000),
    min('x1', 'A', 'm1', 1100),
    min('x2', 'A', 'm2', 1200),
    rep('b1', 'B', 6, 2000),
    ...mins('B', 2100),
    min('x3', 'A', 'm3', 5000),
  ];
  const s = computeRunState(ops, base);
  assert.equal(s.exercises[0]?.completedAt, T0 + 5000);
  assert.equal(s.exercises[1]?.completedAt, T0 + 5000, 'ramene a la validation de A');
  assert.equal(s.exercises[1]?.splitMs, 0);
  assert.equal(s.finishTs, T0 + 5000);
});

test('une rep hors-ligne arrivee en retard se reinsere a sa place chronologique', () => {
  const enLigne = [...mins('A', 10), rep('a1', 'A', 6, 1000), rep('a3', 'A', 4, 8000)];
  assert.equal(computeRunState(enLigne, base).exercises[0]?.completedAt, T0 + 8000);

  const apres = computeRunState([...enLigne, rep('a2', 'A', 4, 3000)], base);
  assert.equal(apres.exercises[0]?.completedAt, T0 + 3000, 'le temps de validation est corrige');
});

test('l ordre d arrivee des ops ne change jamais le resultat', () => {
  const ops = [...mins('A', 10), rep('a1', 'A', 6, 1000), rep('a2', 'A', 5, 2000), rep('b1', 'B', 6, 3000), ...mins('B', 4000)];
  assert.deepEqual(computeRunState([...ops].reverse(), base), computeRunState(ops, base));
});

test('annuler une rep de A apres coup rouvre A et tout ce qui suit', () => {
  const ops = [...mins('A', 10), rep('a1', 'A', 10, 1000), rep('b1', 'B', 6, 2000), ...mins('B', 3000)];
  assert.equal(computeRunState(ops, base).finished, true);

  const s = computeRunState([...ops, undo('u1', 'a1', 4000)], base);
  assert.equal(s.exercises[0]?.completedAt, null);
  assert.equal(s.exercises[1]?.completedAt, null);
  assert.equal(s.currentIndex, 0);
  assert.equal(s.finished, false);
});

test('decocher un minimum invalide l epreuve, le recocher la revalide a ce moment', () => {
  const ops = [...mins('A', 10), rep('a1', 'A', 10, 1000)];
  const decoche = [...ops, undo('u1', 'min-A-m2', 2000)];
  assert.equal(computeRunState(decoche, base).exercises[0]?.completedAt, null);

  const recoche = computeRunState([...decoche, min('again', 'A', 'm2', 3000)], base);
  assert.equal(recoche.exercises[0]?.completedAt, T0 + 3000);
});

test('une validation rejouee ne decale pas l instant de validation', () => {
  const ops = [...mins('A', 10), rep('a1', 'A', 10, 1000), min('bis', 'A', 'm3', 9000)];
  assert.equal(computeRunState(ops, base).exercises[0]?.completedAt, T0 + 1000);
});

test('les minimums sont propres a chaque epreuve', () => {
  const ops = [...mins('A', 10), rep('a1', 'A', 10, 1000), rep('b1', 'B', 6, 2000)];
  const s = computeRunState(ops, base);
  assert.equal(s.exercises[0]?.minimumsComplete, true);
  assert.equal(s.exercises[1]?.minimumsComplete, false, 'les cases de A ne valent pas pour B');
});

test('membre ou epreuve inconnus : ignores sans rien casser', () => {
  const ops = [rep('a1', 'A', 10, 1000), min('x', 'A', 'intrus', 1500), rep('z', 'Z', 99, 1600)];
  const s = computeRunState(ops, base);
  assert.equal(s.exercises[0]?.minimumsComplete, false);
  assert.equal(s.exercises.length, 2);
});

test('minimum par membre desactive : seuls les points comptent', () => {
  const s = computeRunState([rep('a1', 'A', 10, 1000), rep('b1', 'B', 6, 2000)], {
    ...base,
    minRepsPerMember: 0,
  });
  assert.equal(s.finished, true);
  assert.equal(s.finishTs, T0 + 2000);
});

test('les pauses ne comptent pas dans le temps officiel', () => {
  const segments = [
    { startedAt: T0, endedAt: T0 + 2000 },
    { startedAt: T0 + 10000, endedAt: null },
  ];
  assert.equal(elapsedAt(segments, T0 + 1000), 1000);
  assert.equal(elapsedAt(segments, T0 + 5000), 2000, 'pendant la pause le temps est fige');
  assert.equal(elapsedAt(segments, T0 + 11000), 3000);

  const ops = [...mins('A', 0), rep('a1', 'A', 10, 11000), ...mins('B', 11000), rep('b1', 'B', 6, 11500)];
  const s = computeRunState(ops, { ...base, segments });
  assert.equal(s.elapsedMs, 3500);
});

test('formatChrono respecte le format des maquettes', () => {
  assert.equal(formatChrono(4 * 60000 + 32 * 1000 + 760), '04 : 32 : 76');
  assert.equal(formatChrono(-5), '00 : 00 : 00');
});
