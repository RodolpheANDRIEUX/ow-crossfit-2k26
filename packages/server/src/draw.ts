import type { JudgeRole, Member, Team } from '@ow/shared';

export interface DrawnAssignment {
  teamId: string;
  judgeMemberId: string;
  role: JudgeRole;
}

export interface DrawnHeat {
  teamIds: string[];
  assignments: DrawnAssignment[];
  warnings: string[];
}

export interface DrawOptions {
  teams: Team[];
  /** Equipes a programmer (les autres fournissent les arbitres). */
  teamIds: string[];
  /** Nombre d'equipes qui passent en meme temps. */
  groupSize: number;
  rng?: () => number;
}

/** Une equipe qui passe mobilise exactement trois arbitres. */
const ROLES: JudgeRole[] = ['form', 'counter', 'timer'];

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/**
 * Tirage au sort du deroulement.
 *
 * Regles du cahier des charges :
 * - les equipes passent par series (`groupSize` equipes en simultane) ;
 * - les arbitres sont pris parmi les equipes qui ne passent pas dans la serie ;
 * - chaque equipe est arbitree par 3 personnes de 3 equipes differentes ;
 * - le poste de juge de forme revient a quelqu'un d'habilite.
 *
 * Le tirage n'echoue jamais : s'il manque du monde, il relache les contraintes
 * une a une et signale precisement ce qui a du etre assoupli.
 */
export function drawHeats(options: DrawOptions): DrawnHeat[] {
  const rng = options.rng ?? Math.random;
  const byId = new Map(options.teams.map((t) => [t.id, t]));
  const scheduled = options.teamIds.map((id) => byId.get(id)).filter(Boolean) as Team[];
  const size = Math.max(1, options.groupSize);

  const order = shuffle(scheduled, rng);
  const heats: DrawnHeat[] = [];
  for (let i = 0; i < order.length; i += size) {
    const group = order.slice(i, i + size);
    heats.push(assignHeat(group, options.teams, rng));
  }
  return heats;
}

function assignHeat(group: Team[], allTeams: Team[], rng: () => number): DrawnHeat {
  const inHeat = new Set(group.map((t) => t.id));
  const pool: Member[] = allTeams.filter((t) => !inHeat.has(t.id)).flatMap((t) => t.members);

  // Plusieurs tentatives aleatoires : suffisant et bien plus lisible qu'un
  // backtracking complet pour une vingtaine de participants.
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = tryAssign(group, pool, rng, { strict: true, requireForm: true });
    if (result) return { teamIds: group.map((t) => t.id), assignments: result, warnings: [] };
  }

  const relaxedTeams = tryAssign(group, pool, rng, { strict: false, requireForm: true });
  if (relaxedTeams) {
    return {
      teamIds: group.map((t) => t.id),
      assignments: relaxedTeams,
      warnings: ['effectif juste : certains arbitres viennent de la même équipe.'],
    };
  }

  const relaxed = tryAssign(group, pool, rng, { strict: false, requireForm: false });
  return {
    teamIds: group.map((t) => t.id),
    assignments: relaxed ?? [],
    warnings: [
      relaxed
        ? 'pas assez de juges de forme habilités : vérifie le poste « forme ».'
        : "pas assez d'arbitres disponibles : affectations à faire à la main.",
    ],
  };
}

function tryAssign(
  group: Team[],
  pool: Member[],
  rng: () => number,
  opts: { strict: boolean; requireForm: boolean },
): DrawnAssignment[] | null {
  const used = new Set<string>();
  const assignments: DrawnAssignment[] = [];

  for (const team of shuffle(group, rng)) {
    const free = shuffle(
      pool.filter((m) => !used.has(m.id)),
      rng,
    );
    const chosen: Member[] = [];
    const usedTeams = new Set<string>();

    // Le juge de forme d'abord : c'est le seul poste qui demande une habilitation.
    const formJudge = free.find((m) => m.canJudgeForm);
    if (formJudge) {
      chosen.push(formJudge);
      usedTeams.add(formJudge.teamId);
    } else if (opts.requireForm) {
      return null;
    }

    for (const candidate of free) {
      if (chosen.length >= ROLES.length) break;
      if (chosen.some((c) => c.id === candidate.id)) continue;
      if (opts.strict && usedTeams.has(candidate.teamId)) continue;
      chosen.push(candidate);
      usedTeams.add(candidate.teamId);
    }

    if (chosen.length < ROLES.length) return null;

    chosen.forEach((judge, index) => {
      used.add(judge.id);
      assignments.push({
        teamId: team.id,
        judgeMemberId: judge.id,
        role: ROLES[index] as JudgeRole,
      });
    });
  }

  return assignments;
}
