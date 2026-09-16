import test from 'node:test';
import assert from 'node:assert/strict';
import type { Team } from '@ow/shared';
import { drawHeats } from './draw.ts';

function makeTeams(count: number, size = 3, formPerTeam = 1): Team[] {
  return Array.from({ length: count }, (_, t) => ({
    id: `t${t}`,
    name: `Equipe ${t}`,
    position: t,
    members: Array.from({ length: size }, (_, m) => ({
      id: `t${t}m${m}`,
      teamId: `t${t}`,
      name: `Membre ${t}.${m}`,
      code: `C${t}${m}`,
      canJudgeForm: m < formPerTeam,
      position: m,
    })),
  }));
}

const teamOf = (memberId: string) => memberId.slice(0, memberId.indexOf('m'));

test('decoupe les equipes en series de la taille demandee', () => {
  const teams = makeTeams(7);
  const heats = drawHeats({ teams, teamIds: teams.map((t) => t.id), groupSize: 3 });
  assert.equal(heats.length, 3);
  assert.deepEqual(
    heats.map((h) => h.teamIds.length),
    [3, 3, 1],
  );
  assert.equal(new Set(heats.flatMap((h) => h.teamIds)).size, 7, 'chaque equipe passe une fois');
});

test('trois postes par equipe : compteur, chrono, juge de forme', () => {
  const teams = makeTeams(6);
  const heats = drawHeats({ teams, teamIds: teams.map((t) => t.id), groupSize: 3 });

  for (const heat of heats) {
    assert.deepEqual(heat.warnings, [], 'aucune contrainte relachee avec cet effectif');
    const judges = heat.assignments.map((a) => a.judgeMemberId);
    assert.equal(new Set(judges).size, judges.length, 'personne n arbitre deux fois');

    for (const teamId of heat.teamIds) {
      const forTeam = heat.assignments.filter((a) => a.teamId === teamId);
      assert.deepEqual(
        forTeam.map((a) => a.role).sort(),
        ['counter', 'form', 'timer'],
        'les trois postes sont pourvus, une fois chacun',
      );

      const judgeTeams = forTeam.map((a) => teamOf(a.judgeMemberId));
      assert.equal(new Set(judgeTeams).size, 3, '3 equipes differentes');
      assert.equal(
        judgeTeams.some((id) => heat.teamIds.includes(id)),
        false,
        'aucun arbitre pris dans une equipe qui passe',
      );

      const form = forTeam.find((a) => a.role === 'form');
      assert.equal(form?.judgeMemberId.endsWith('m0'), true, 'le juge de forme est habilite');
    }
  }
});

test('effectif insuffisant : previent au lieu d echouer', () => {
  const teams = makeTeams(2);
  const heats = drawHeats({ teams, teamIds: teams.map((t) => t.id), groupSize: 1 });
  assert.equal(heats.length, 2);
  assert.equal(
    heats.every((h) => h.warnings.length > 0),
    true,
    'la contrainte relachee est signalee',
  );
});

test('sans juge de forme disponible, le tirage aboutit et le signale', () => {
  const teams = makeTeams(4, 3, 0); // personne n'est habilite
  const heats = drawHeats({ teams, teamIds: teams.map((t) => t.id), groupSize: 2 });
  const heat = heats[0]!;
  assert.equal(heat.assignments.length, 6, 'les postes sont quand meme pourvus');
  assert.match(heat.warnings.join(' '), /forme/);
});

test('on peut ne programmer qu une partie des equipes', () => {
  const teams = makeTeams(6);
  const heats = drawHeats({ teams, teamIds: ['t0', 't1'], groupSize: 2 });
  assert.equal(heats.length, 1);
  assert.deepEqual([...heats[0]!.teamIds].sort(), ['t0', 't1']);
});
