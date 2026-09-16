import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRunState } from './scoring.ts';
import { buildTrack, positionAt, workoutProgress } from './replay.ts';
import type { Op } from './types.ts';

const T0 = 1_700_000_000_000;
const MEMBERS = ['m1', 'm2', 'm3'];

const options = {
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
  op({ id, type: 'rep', exerciseId, points, clientTs: T0 + offset });
const mins = (exerciseId: string, offset: number) =>
  MEMBERS.map((memberId, i) => op({ id: `min-${exerciseId}-${memberId}`, type: 'min', exerciseId, memberId, clientTs: T0 + offset }));

const workout = [
  ...mins('A', 100),
  rep('a1', 'A', 5, 1000),
  rep('a2', 'A', 5, 2000), // A validee
  ...mins('B', 2500),
  rep('b1', 'B', 3, 4000),
  rep('b2', 'B', 3, 6000), // arrivee
];

test('l avancement va de 0 a 1 epreuve par epreuve', () => {
  assert.equal(workoutProgress(computeRunState([], options)), 0);
  assert.equal(workoutProgress(computeRunState(workout.slice(0, 4), options)), 0.25, 'moitie de A = quart du workout');
  assert.equal(workoutProgress(computeRunState(workout, options)), 1);
});

test('le trace part de zero et arrive a 1 au temps officiel', () => {
  const track = buildTrack(workout, options);
  const state = computeRunState(workout, options);
  assert.deepEqual(track[0], [0, 0, 0]);
  const last = track[track.length - 1]!;
  assert.equal(last[1], 1);
  assert.equal(last[0], state.elapsedMs, 'le point d arrivee tombe sur le temps officiel');
});

test('le trace suit chaque input dans l ordre, quel que soit l ordre du journal', () => {
  assert.deepEqual(buildTrack([...workout].reverse(), options), buildTrack(workout, options));
  const times = buildTrack(workout, options).map((p) => p[0]);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'le temps ne recule jamais');
});

test('une annulation fait reculer l equipe', () => {
  const ops = [...mins('A', 100), rep('a1', 'A', 5, 1000), op({ id: 'u', type: 'undo', targetOpId: 'a1', clientTs: T0 + 1500 })];
  const track = buildTrack(ops, options);
  assert.deepEqual(
    track.map((p) => p[1]),
    [0, 0.25, 0],
  );
});

test('les actions simultanees ne font qu un point', () => {
  const ops = [...mins('A', 100), rep('a1', 'A', 5, 1000), rep('a2', 'A', 1, 1000)];
  assert.equal(buildTrack(ops, options).length, 2);
});

test('positionAt renvoie le dernier point atteint', () => {
  const track = buildTrack(workout, options);
  assert.deepEqual(positionAt(track, -5), { progress: 0, exerciseIndex: 0 });
  assert.deepEqual(positionAt(track, 1500), { progress: 0.25, exerciseIndex: 0 });
  assert.deepEqual(positionAt(track, 2000), { progress: 0.5, exerciseIndex: 1 });
  assert.equal(positionAt(track, 99_999).progress, 1);
});
