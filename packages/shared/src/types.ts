/**
 * Types du domaine, partages par le serveur et le client.
 * Toutes les dates transitent en millisecondes epoch (number) : pas d'ambiguite
 * de fuseau ni de parsing, et comparaison directe des horodatages clients.
 */

export type RunStatus = 'pending' | 'running' | 'paused' | 'finished';
export type HeatStatus = 'pending' | 'active' | 'done';

/**
 * Les trois postes d'arbitrage d'une equipe qui passe.
 *
 * - `counter` : compte les repetitions de l'equipe entiere (le seul a taper) ;
 * - `timer`   : tient le chrono et valide les repetitions minimum de chaque membre ;
 * - `form`    : juge la forme des mouvements, sans ecran a manipuler.
 */
export type JudgeRole = 'counter' | 'timer' | 'form';

/**
 * - `rep`  : une repetition comptee pour l'equipe, sur une epreuve ;
 * - `min`  : le minimum de repetitions d'un membre est valide, sur une epreuve ;
 * - `undo` : annule une operation precedente (repetition ou validation).
 */
export type OpType = 'rep' | 'undo' | 'min';

export interface EventConfig {
  id: string;
  name: string;
  /**
   * Debut de l'edition en cours (null entre deux editions). Pendant une
   * edition, les arbitres voient leurs affectations et la configuration est
   * verrouillee.
   */
  runningSince: number | null;
  /**
   * Configuration verrouillee (= une edition est en cours) : epreuves, points,
   * minimums, equipes et habilitations ne bougent plus, le serveur refuse. Le
   * deroulement et la regeneration d'un code de connexion restent possibles.
   */
  locked: boolean;
  teamSize: number;
  /** Nombre minimum de repetitions que chaque membre doit realiser sur chaque epreuve. */
  minRepsPerMember: number;
}

export interface Member {
  id: string;
  teamId: string;
  name: string;
  /** Code court de connexion (visible de l'admin uniquement). */
  code: string;
  /** Habilite a juger la forme des mouvements. */
  canJudgeForm: boolean;
  position: number;
}

export interface Team {
  id: string;
  name: string;
  position: number;
  members: Member[];
}

export interface Variant {
  id: string;
  exerciseId: string;
  name: string;
  points: number;
  position: number;
  /** Image affichee sur le bouton du compteur. */
  imageId: string | null;
}

/** Une epreuve du workout. L'ordre (`position`) est l'ordre dans lequel on les enchaine. */
export interface Exercise {
  id: string;
  name: string;
  targetPoints: number;
  position: number;
  variants: Variant[];
  /** Image affichee dans le catalogue des epreuves. */
  imageId: string | null;
}

export interface Assignment {
  id: string;
  heatId: string;
  runId: string;
  teamId: string;
  /** Arbitre (membre d'une autre equipe). */
  judgeMemberId: string;
  role: JudgeRole;
}

/** Une serie : des equipes qui font le workout complet en meme temps. */
export interface Heat {
  id: string;
  eventId: string;
  name: string;
  position: number;
  status: HeatStatus;
  teamIds: string[];
  assignments: Assignment[];
}

/** Intervalle d'activite du chrono d'un passage (gestion des pauses). */
export interface Segment {
  startedAt: number;
  endedAt: number | null;
}

export interface Op {
  id: string;
  runId: string;
  type: OpType;
  /** Epreuve concernee ('rep' et 'min'). */
  exerciseId: string | null;
  /** Membre dont le minimum est valide (type 'min'). */
  memberId: string | null;
  variantId: string | null;
  points: number;
  /** Horodatage pose par le client AU MOMENT DE L'ACTION (source de verite du temps). */
  clientTs: number;
  /** Op annulee par cette op (type 'undo'). */
  targetOpId: string | null;
  /** Arbitre auteur de l'op. */
  judgeMemberId: string | null;
}

/** Validation, par l'arbitre au chrono, des repetitions minimum d'un membre. */
export interface MemberMinimum {
  memberId: string;
  validated: boolean;
  /** Instant de la validation (horodatage client). */
  validatedAt: number | null;
}

/** Avancement d'une equipe sur une epreuve du workout. */
export interface ExerciseProgress {
  exerciseId: string;
  score: number;
  targetPoints: number;
  totalReps: number;
  pointsReached: boolean;
  minimums: MemberMinimum[];
  minimumsComplete: boolean;
  /**
   * Instant ou l'epreuve est validee : objectif de points ET minimums, jamais
   * avant la validation de l'epreuve precedente.
   */
  completedAt: number | null;
  /** Temps passe sur cette epreuve (chrono actif uniquement). */
  splitMs: number | null;
}

/** Etat du workout d'une equipe, recalcule de facon deterministe a partir des ops. */
export interface RunState {
  exercises: ExerciseProgress[];
  /** Epreuve en cours : la premiere non validee (egal au nombre d'epreuves une fois termine). */
  currentIndex: number;
  finished: boolean;
  /** Instant de validation de la derniere epreuve (horodatage client). */
  finishTs: number | null;
  /** Temps officiel du workout (chrono actif uniquement). */
  elapsedMs: number | null;
}

/** Un passage = le workout complet d'une equipe, avec un seul chrono. */
export interface Run {
  id: string;
  eventId: string;
  teamId: string;
  heatId: string | null;
  status: RunStatus;
  segments: Segment[];
  finishedAt: number | null;
  elapsedMs: number | null;
  /**
   * Instant de la derniere remise a zero par l'organisation. Tout ce qui a ete
   * fait avant est ecarte — par le serveur comme par les telephones.
   */
  resetAt: number | null;
}

/** Photo complete d'un passage diffusee en temps reel. */
export interface RunSnapshot {
  run: Run;
  state: RunState;
  /** Horloge serveur au moment de l'envoi, pour recaler le chrono du client. */
  serverNow: number;
}

export interface JudgeSession {
  token: string;
  member: Member;
  teamName: string;
}

export interface CurrentAssignment {
  assignment: Assignment;
  run: Run;
  team: Team;
  /** Les epreuves du workout, dans l'ordre, avec leurs variantes. */
  exercises: Exercise[];
}

/* ------------------------------------------------------------------ */
/* Editions archivees                                                  */
/* ------------------------------------------------------------------ */

/**
 * Point du trace de course d'une equipe : [temps de chrono ecoule (ms),
 * avancement dans le workout (0 → 1), epreuve en cours].
 */
export type TrackPoint = [t: number, progress: number, exerciseIndex: number];

export interface EditionSummary {
  id: string;
  name: string;
  schemaVersion: number;
  startedAt: number;
  endedAt: number;
  teams: number;
  finished: number;
  winner: string | null;
  winnerMs: number | null;
}

export interface EditionTeamV1 {
  id: string;
  name: string;
  /** Ordre de l'equipe dans la configuration : couloir neutre pour la course rejouee. */
  position: number;
  heatName: string | null;
  members: { id: string; name: string }[];
  result: {
    started: boolean;
    finished: boolean;
    elapsedMs: number | null;
    currentIndex: number;
    /** Avancement final (0 → 1), pour classer les equipes non arrivees. */
    progress: number;
    rank: number | null;
    /** Temps intermediaires, dans l'ordre des epreuves de l'edition. */
    splits: (number | null)[];
  };
  track: TrackPoint[];
  /** Journal brut, conserve en base pour audit ; jamais renvoye par l'API. */
  raw?: { ops: Op[]; segments: Segment[] };
}

/**
 * Photo figee d'une edition terminee, autosuffisante : equipes, epreuves,
 * resultats et traces y sont recopies. Les equipes, les epreuves ou l'app
 * elle-meme peuvent changer ensuite, l'historique reste lisible tel quel.
 * `schemaVersion` permet a une version future de l'app d'adapter la lecture.
 */
export interface EditionV1 {
  schemaVersion: 1;
  name: string;
  startedAt: number;
  endedAt: number;
  minRepsPerMember: number;
  exercises: {
    id: string;
    name: string;
    targetPoints: number;
    position: number;
    variants: { id: string; name: string; points: number }[];
  }[];
  /** Equipes triees par classement final. */
  teams: EditionTeamV1[];
}

export type ServerMessage =
  | { type: 'hello'; serverNow: number }
  | { type: 'run'; snapshot: RunSnapshot }
  /** Nouvelles operations d'un passage : chaque appareil les fusionne a son journal local. */
  | { type: 'ops'; runId: string; ops: Op[] }
  | { type: 'config'; version: number }
  | { type: 'assignments'; version: number }
  | { type: 'pong'; serverNow: number };

export type ClientMessage =
  | { type: 'subscribe'; runIds: string[] }
  | { type: 'ping' };
