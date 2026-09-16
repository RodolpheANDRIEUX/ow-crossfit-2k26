-- Schema unique et idempotent : rejoue a chaque demarrage du serveur.
create extension if not exists pgcrypto;

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team_size int not null default 3,
  min_reps_per_member int not null default 5,
  created_at timestamptz not null default now()
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  position int not null default 0
);

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  code text not null,
  can_judge_form boolean not null default false,
  position int not null default 0
);
create unique index if not exists members_code_uk on members (upper(code));

-- Les epreuves du workout. `position` = ordre dans lequel on les enchaine.
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  target_points int not null default 60,
  position int not null default 0
);

create table if not exists variants (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references exercises(id) on delete cascade,
  name text not null,
  points int not null default 1,
  position int not null default 0
);

-- ------------------------------------------------------------------------
-- Migrations
--
-- v3 : un passage n'est plus « une equipe sur une epreuve » mais « le workout
-- complet d'une equipe », epreuves enchainees sous un seul chrono. Les tables
-- de deroulement et de comptage de l'ancien modele sont recreees ; la
-- configuration (evenement, equipes, epreuves, variantes) est conservee.
-- ------------------------------------------------------------------------
create table if not exists schema_meta (version int not null);

do $$
begin
  if coalesce((select max(version) from schema_meta), 0) < 3 then
    drop table if exists ops, assignments, run_segments, runs, heats cascade;
    delete from schema_meta;
    insert into schema_meta (version) values (3);
  end if;
end $$;

-- v4 : suppression de l'ancien statut d'evenement (preparation / en cours / termine).
do $$
begin
  if coalesce((select max(version) from schema_meta), 0) < 4 then
    alter table events drop column if exists status;
    delete from schema_meta;
    insert into schema_meta (version) values (4);
  end if;
end $$;

-- v5 : editions. Le verrou manuel disparait : la configuration est verrouillee
-- exactement pendant une edition lancee.
alter table events add column if not exists running_since bigint;

do $$
begin
  if coalesce((select max(version) from schema_meta), 0) < 5 then
    alter table events drop column if exists locked;
    delete from schema_meta;
    insert into schema_meta (version) values (5);
  end if;
end $$;

-- Images des epreuves et des variantes. Jamais modifiees : une nouvelle image
-- a un nouvel identifiant, ce qui permet aux telephones de les garder en cache.
create table if not exists images (
  id uuid primary key default gen_random_uuid(),
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
alter table exercises add column if not exists image_id uuid references images(id) on delete set null;
alter table variants add column if not exists image_id uuid references images(id) on delete set null;

-- Editions terminees : photo figee et autosuffisante (equipes, epreuves,
-- resultats, traces), lisible meme si la configuration ou l'app changent.
create table if not exists editions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  schema_version int not null,
  started_at bigint not null,
  ended_at bigint not null,
  summary jsonb not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

-- Une edition terminee ne se modifie plus, y compris par erreur ou par une
-- future version de l'app.
create or replace function editions_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'edition terminee : modification interdite';
end $$;
drop trigger if exists editions_no_update on editions;
create trigger editions_no_update before update on editions
  for each row execute function editions_immutable();

-- Une serie : des equipes qui font le workout complet en meme temps.
create table if not exists heats (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  position int not null default 0,
  status text not null default 'pending'
);

-- Un passage = le workout complet d'une equipe. Un seul par equipe.
create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_id uuid not null unique references teams(id) on delete cascade,
  heat_id uuid references heats(id) on delete set null,
  status text not null default 'pending',
  finish_ts bigint,
  elapsed_ms bigint
);

-- Instant de la derniere remise a zero : les operations anterieures sont ecartees,
-- sur le serveur comme dans le journal local des telephones.
alter table runs add column if not exists reset_at bigint;

-- Periodes d'activite du chrono (une par demarrage/reprise) : les pauses ne comptent pas.
create table if not exists run_segments (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  started_at bigint not null,
  ended_at bigint
);
create index if not exists run_segments_run_idx on run_segments (run_id, started_at);

-- Trois postes par equipe qui passe : compteur, chrono, juge de forme.
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  heat_id uuid not null references heats(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  judge_member_id uuid not null references members(id) on delete cascade,
  role text not null default 'counter'
);
-- Un seul arbitre par poste et par passage.
create unique index if not exists assignments_role_uk on assignments (run_id, role);
-- Un arbitre n'a qu'une seule affectation par serie.
create unique index if not exists assignments_judge_uk
  on assignments (heat_id, judge_member_id);

-- Journal d'operations : source de verite unique du comptage.
-- L'id est genere par le client -> le rejeu d'un envoi ne cree jamais de doublon.
--   type 'rep'  : une repetition de l'equipe sur une epreuve (variante + points)
--   type 'min'  : les repetitions minimum d'un membre sont validees sur une epreuve
--   type 'undo' : annule une operation precedente (target_op_id)
create table if not exists ops (
  id uuid primary key,
  run_id uuid not null references runs(id) on delete cascade,
  type text not null,
  exercise_id uuid,
  member_id uuid,
  variant_id uuid,
  points int not null default 0,
  client_ts bigint not null,
  target_op_id uuid,
  judge_member_id uuid,
  received_at timestamptz not null default now()
);
create index if not exists ops_run_idx on ops (run_id, client_ts);
