# OW — Compteur

Application de comptage et de chronométrage pour l'épreuve CrossFit des **Olympic Warriors** :
des équipes de 3 qui enchaînent un workout complet, un arbitre qui compte au tap sur son
téléphone, un chrono qui s'arrête tout seul à la validation de la dernière épreuve, et un
classement au temps.

Cahier des charges d'origine : [`docs/CAHIER-DES-CHARGES.md`](docs/CAHIER-DES-CHARGES.md).

---

## Démarrage rapide

```bash
cp .env.example .env        # puis change AUTH_SECRET et ADMIN_CODE
npm install
docker compose up -d db     # PostgreSQL en local
npm run dev                 # API :3000 + front :5173
```

Si un PostgreSQL tourne déjà sur ta machine, le port 5432 est pris : mets `DB_PORT=55432` dans
`.env` et ajuste `DATABASE_URL` en conséquence.

Ouvre <http://localhost:5173>, onglet **Organisation**, code = `ADMIN_CODE` (`OW2026` par défaut).
Sans équipes, l'onglet Équipes propose un **jeu de démonstration** (6 équipes, 4 épreuves) pour
tout essayer en trente secondes.

Vérifier que la chaîne complète fonctionne (tirage au sort, comptage, hors-ligne, temps réel) :

```bash
node scripts/smoke.mjs
```

Production, tout-en-un derrière Traefik :

```bash
docker compose up -d --build
```

---

## Ce que fait l'application

### Organisation (`/admin`)

Dans l'ordre où l'organisation s'en sert — préparer, puis faire tourner :

| Onglet | Rôle |
|---|---|
| **Épreuves** *(par défaut)* | les épreuves du workout **dans l'ordre où elles s'enchaînent**, objectif de points, variantes, minimum de reps par participant |
| **Équipes** | équipes, participants, habilitation « juge de forme », codes de connexion |
| **Déroulement** | tirage au sort des séries et des arbitres, échanges de dernière minute |
| **Live** | **lancement des séries**, avancement de chaque équipe dans le workout, classement avec temps par épreuve |
| **Historique** | éditions terminées, résultats figés, et la course rejouée en 30 secondes |

Le **tirage au sort** respecte les règles du cahier des charges : les arbitres sont pris dans les
équipes qui ne passent pas, et chaque équipe reçoit 3 arbitres de 3 équipes différentes — un
compteur, un chrono, et un juge de forme habilité. Si l'effectif est trop juste, le tirage
n'échoue pas : il relâche une contrainte et dit précisément laquelle.

### Éditions

Le titre en haut à gauche nomme l'**édition**. Le bouton **Lancer** la démarre :
- les arbitres voient leurs affectations (avant, ils ne voient que le catalogue des épreuves) ;
- la configuration est verrouillée — épreuves, ordre, objectifs, points, minimum de reps,
  équipes, habilitations et titre sont refusés par le serveur, pas seulement grisés. Le cadenas
  à côté du titre en est le témoin. Le déroulement et la régénération d'un code restent possibles ;
- si le titre existe déjà dans l'historique, l'édition devient « Titre (1) », « Titre (2) »…

**Terminer** fige les résultats dans une édition **immuable** (une contrainte en base interdit
toute modification), puis remet séries et comptages à zéro pour la suivante. Un tap d'une
édition terminée qui arriverait plus tard d'un téléphone hors-ligne est refusé.

Chaque édition est **autosuffisante** : équipes, épreuves, résultats et tracé de course y sont
recopiés, avec un numéro de format (`schemaVersion`). Les équipes, les épreuves ou l'application
peuvent changer d'une édition à l'autre, l'historique reste lisible tel qu'il a été vécu.

### Historique et course rejouée

L'onglet **Historique** liste les éditions et leur classement avec les temps par épreuve.
**Rejouer la course** remonte chaque input à son instant — une répétition fait avancer l'équipe,
une annulation la fait reculer — avec toutes les équipes côte à côte, même parties dans des
séries différentes (chacune court sur son propre chrono). La course dure 30 secondes quelle que
soit la durée réelle, et le résultat n'est pas dévoilé : les couloirs suivent l'ordre des
équipes, pas le classement.

### Images

Chaque épreuve et chaque variante peut recevoir une image (bouton « + » dans l'onglet
Épreuves). Elle est redimensionnée dans le navigateur avant envoi, puis affichée sur les boutons
du compteur et dans le catalogue des participants. Les images sont gardées en cache sur les
téléphones : elles restent visibles hors-ligne.

### Arbitre (`/arbitre`)

Connexion par nom + code court. Tant que l'édition n'est pas lancée, le participant voit le
**catalogue des épreuves** : une tuile par épreuve, et au toucher ses variantes et leurs points.

Le menu ⋯ propose un **thème clair**, plus lisible en plein soleil, mémorisé sur le téléphone.

Une fois l'édition lancée, **uniquement son affectation du moment** :
aucun menu, aucune sélection. Une équipe qui passe mobilise **trois arbitres, un par poste** :

| Poste | Son écran | Ce qu'il fait |
|---|---|---|
| **Compteur** | les gros boutons de variantes | compte les répétitions de **toute l'équipe** — c'est le seul à taper. `Annuler` et historique complet |
| **Chrono** | chrono, score, **3 cases** | tient le chrono et valide les répétitions minimum de chaque membre |
| **Forme** | un écran volontairement muet | juge l'exécution et fait signe au compteur pour annuler une répétition |

**Un passage, c'est le workout complet** : les épreuves s'enchaînent (Pompes → Tractions →
Burpees → Toes to bar) sous **un seul chrono**, avec les mêmes trois arbitres du début à la fin.

- Une épreuve est **validée quand deux conditions tiennent ensemble** : son objectif de points
  est atteint **et** ses trois minimums sont cochés — la dernière des deux actions fixe l'instant.
- Dès qu'elle l'est, **tout le monde passe à la suivante** : le compteur reçoit les nouveaux
  boutons, le chrono voit ses cases remises à zéro, un bref message l'annonce.
- **Tant qu'un minimum manque, on ne passe pas à la suite** : les boutons du compteur restent
  ceux de l'épreuve en cours — les répétitions comptées en plus sont justement celles du membre
  qui n'a pas fait son minimum. Le compteur voit en orange qui manque et qui doit valider.
- Le chrono s'arrête à la validation de la **dernière** épreuve. Chaque épreuve a son temps
  intermédiaire ; leur somme est exactement le temps total.
- Une épreuve ne peut jamais être validée avant la précédente, même si une validation tardive
  ou un écart d'horloge le laisserait croire : aucun temps intermédiaire n'est négatif.

Le chrono, lui, n'appartient qu'à l'arbitre au chrono : l'organisation ne le pilote pas depuis
le panneau Live (elle peut seulement remettre un passage à zéro en cas de faux départ).

L'arbitre au chrono dispose d'une **aide au comptage** discrète (le petit `0/5` sur chaque carte) :
elle est strictement locale, n'est jamais envoyée, et coche la case toute seule à la cinquième
répétition. Elle ne touche jamais au score de l'équipe.

Tout fonctionne **hors-ligne**. Les taps et les validations sont écrits localement puis renvoyés
seuls dès le retour du réseau.

---

## Installer l'application sur un téléphone

Sur téléphone, l'écran d'arrivée ne propose qu'une chose : **installer l'app**. Un petit lien
« continuer dans le navigateur » sert de repli.

**Ce qu'il faut savoir** : Chrome n'installe une application que depuis une origine **sécurisée**
(`https://`, ou `localhost`). En `http://` sur une IP locale — `http://192.168.1.80:3000` —
le service worker est refusé, l'application n'est jamais « installable », et « installer / créer
un raccourci » ne fabrique qu'un marque-page qui rouvre le navigateur. L'écran d'accueil le
détecte et l'affiche, plutôt que de laisser un bouton qui ne fait rien.

Trois façons d'obtenir une origine sécurisée :

| Situation | Marche à suivre |
|---|---|
| **Le jour J** | le domaine public en HTTPS derrière Traefik — rien à faire de plus |
| **Test en LAN, propre** | `mkcert 192.168.1.80 localhost`, renseigner `TLS_CERT`/`TLS_KEY` dans `.env`, puis installer la CA de mkcert sur le téléphone (Android : Paramètres → Sécurité → Installer un certificat) |
| **Test en LAN, rapide** | un tunnel HTTPS (`cloudflared tunnel --url http://localhost:3000`) — certificat valide immédiatement |

Un certificat auto-signé **non installé sur le téléphone** ne suffit pas : Chrome refuse les
service workers sur une origine dont le certificat est en erreur, même après avoir cliqué
« continuer ».

---

## Tester plusieurs arbitres depuis un seul navigateur

Deux onglets partagent le même stockage : sans précaution, ils seraient le même arbitre. Ajouter
`?session=<nom>` à l'adresse donne à l'onglet son propre espace — jeton, file d'attente
hors-ligne, cache d'affectation, tout est cloisonné.

```
http://localhost:3000/?session=compteur
http://localhost:3000/?session=chrono
http://localhost:3000/?session=forme
```

Le paramètre suit la navigation. Sans lui, le comportement est exactement celui d'avant : rien ne
change sur les téléphones des arbitres.

---

## Les trois décisions qui font la fiabilité

### 1. Un journal d'opérations, jamais un compteur

On n'incrémente rien. Chaque tap est une ligne immuable (`ops`) avec un **identifiant généré par le
téléphone**. Le score, l'instant de fin et le temps officiel sont **recalculés intégralement** à
chaque réception.

Conséquences directes : un envoi rejoué dix fois reste un seul tap (`on conflict do nothing`),
l'ordre d'arrivée n'a aucune importance, et une annulation est une opération de plus — jamais une
correction destructive.

### 2. L'horodatage vient du geste, pas de la réception

Le temps qui compte est celui de la répétition qui valide l'objectif — pas celui où le serveur a
reçu le paquet. Chaque tap porte donc son `clientTs`, et le serveur trie les répétitions par cet
horodatage avant de chercher l'instant de validation.

Un téléphone qui a compté 40 répétitions hors-ligne pendant deux minutes les resynchronise
ensuite : elles se réinsèrent à leur place chronologique et **le temps officiel est corrigé**, y
compris si le passage était déjà considéré comme terminé.

Comme les horloges des téléphones diffèrent de plusieurs secondes, chaque appareil mesure son
**écart avec l'horloge du serveur** (aller-retour HTTP, moitié de latence défalquée) et l'applique
à tous ses horodatages. L'écart est mémorisé : un téléphone qui redémarre sans réseau date juste.

### 3. Le même calcul des deux côtés

`packages/shared/src/scoring.ts` est importé tel quel par le serveur **et** par le navigateur.
Chaque téléphone recalcule l'état avec ce moteur sur son **journal local** : ses propres
actions, envoyées ou non, et celles des autres arbitres, reçues en temps réel. Une action a le
même identifiant partout, elle n'y figure donc qu'une fois : l'arbitre voit son tap
immédiatement, le compteur change d'épreuve sans attendre le réseau, et aucun croisement entre
réponse et diffusion ne peut compter un tap deux fois — ni faire changer d'épreuve à tort.
Dix-sept tests couvrent ce fichier (`npm test`) : enchaînement des épreuves, resynchronisation
tardive, pauses, minimums cochés puis décochés, épreuve qui ne peut pas passer avant la précédente,
somme des temps intermédiaires.

---

## Architecture

```
packages/
  shared/   types du domaine + moteur de score (partagé, testé)
  server/   Fastify + PostgreSQL + WebSocket
  web/      Svelte 5 + Vite, PWA installable
```

En production, un seul conteneur sert l'API **et** le front compilé : une seule origine, donc pas
de CORS, pas de second nom de domaine, et le WebSocket passe par le même routeur Traefik.

### Modèle de données

| Table | Contenu |
|---|---|
| `events` | l'édition en cours : statut, taille d'équipe, minimum de reps par participant |
| `teams` / `members` | équipes, participants, code de connexion, habilitation « forme » |
| `exercises` / `variants` | épreuves, objectif de points, variantes et leur valeur |
| `heats` | séries : quelles équipes font le workout ensemble |
| `runs` | un passage = le workout complet d'une équipe, sous un seul chrono (un par équipe) |
| `run_segments` | périodes d'activité du chrono — les pauses ne comptent pas |
| `assignments` | qui tient quel poste, pour quelle équipe, dans quelle série |
| `ops` | **le journal des actions** : répétitions, validations de minimums, annulations |

Le schéma (`packages/server/src/schema.sql`) est idempotent et rejoué à chaque démarrage ; le
serveur attend la base jusqu'à une minute si elle démarre après lui.

### API

| Route | Usage |
|---|---|
| `GET /api/roster` | liste des participants pour l'écran de connexion (sans les codes) |
| `POST /api/auth/judge` · `/api/auth/admin` | connexion, jeton signé HMAC (sans session serveur) |
| `GET /api/judge/me` | l'affectation du moment, son passage, son historique |
| `POST /api/ops` | **ingestion des taps**, idempotente, par lots |
| `POST /api/runs/:id/timer` | départ / pause du chrono, avec l'horodatage du geste |
| `GET /api/state` | état complet (organisation) |
| `/api/admin/*` | configuration, tirage au sort, échanges d'arbitres, remises à zéro |
| `WS /ws?token=…` | diffusion des passages et des changements de configuration |

Les points d'une variante sont **toujours relus en base** : le client ne peut pas les décider.

---

## Comportement en conditions dégradées

| Situation | Ce qui se passe |
|---|---|
| Réseau coupé | le comptage continue, les taps s'empilent localement, l'écran indique « n en attente » |
| Onglet fermé, téléphone éteint | les taps non envoyés sont relus au démarrage et repartent seuls |
| Navigation privée / IndexedDB refusé | repli automatique sur `localStorage`, puis sur la mémoire |
| Serveur redémarré | les jetons restent valides (signés, pas stockés), les clients se reconnectent seuls |
| Réponse et diffusion temps réel qui se croisent | chaque action n'existe qu'une fois dans le journal local (même identifiant partout) : jamais de double comptage |
| Chrono lancé sans réseau | la commande est mise en file avec l'heure du geste et rejouée ensuite |
| Compteur hors-ligne au moment où le chrono valide les minimums | le compteur reste sur l'épreuve en cours tant qu'il n'a pas reçu les validations : ses taps continuent d'être comptés là, et tout se remet en place à la reconnexion (les deux arbitres sont côte à côte sur le même agrès) |
| Remise à zéro pendant qu'un téléphone est hors-ligne | tout ce qui a été fait avant la remise à zéro est écarté, par le serveur comme par les téléphones |
| Passage supprimé alors que des taps sont en attente | le serveur les refuse un par un au lieu d'échouer : la file du téléphone ne se bloque jamais |
| `crypto.randomUUID` indisponible (http sur IP locale) | repli sur un générateur maison |

---

## Exploitation

Variables d'environnement (voir `.env.example`) :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | connexion PostgreSQL |
| `AUTH_SECRET` | signature des jetons — **à changer**, invalide toutes les sessions si modifié |
| `ADMIN_CODE` | code d'accès à l'espace organisation |
| `PUBLIC_HOST` | nom de domaine pour les labels Traefik |
| `CORS_ORIGIN` | inutile en production (même origine) ; sert au développement |

Sauvegarde : tout est dans PostgreSQL, et le journal `ops` suffit à tout reconstruire.

```bash
docker compose exec db pg_dump -U ow ow > sauvegarde.sql
```

Le jour J, une sauvegarde toutes les cinq minutes coûte quelques kilo-octets et permet de repartir
d'un serveur de secours sans rien perdre. La bascule vers un second serveur (§9 du cahier des
charges) reste à trancher : le plus simple est une réplication PostgreSQL en streaming et un
basculement DNS/Traefik manuel.

## Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | API et front en développement |
| `npm run build` | compile le front puis le serveur |
| `npm test` | tests du moteur de score |
| `npm run check` | typage strict des trois paquets |
| `node scripts/smoke.mjs` | test de bout en bout sur un serveur en marche — crée deux éditions « Test automatique » dans l'historique |

## Volontairement absent

- **Écran public** (§5.3) : pas d'écran dédié aux spectateurs. La course rejouée de l'onglet
  Historique peut en tenir lieu sur un grand écran.
- La règle « un seul membre sur une variante à la fois » n'est pas contrainte par le logiciel :
  c'est une règle de plateau, l'imposer à l'écran gênerait le comptage sans rien garantir.
- Pas de mot de passe complexe, pas de gestion multi-événements, pas d'export PDF : rien n'est
  nécessaire le jour J, tout alourdirait l'écran d'un arbitre sous pression.
