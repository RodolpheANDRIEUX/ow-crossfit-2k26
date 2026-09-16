# Compteur Sport — Événement par Équipes

## 1. Contexte

Événement multi-sportif organisé en équipes ("OW") avec une epreuve Crossfit. C'est sur cette
    épreuve que l'application est nécessaire pour compter les répétitions et calculer le score de chaque équipe.

Chaque équipe doit atteindre un objectif
de points sur différentes épreuves (pompes, tractions, squats, abdos, ...) et son score sera
le qu'elle met pour y parvenir.

Sur chaque épreuve, les membres de l'équipe réalisent au choix l'une de
plusieurs **variantes** d'exercice, chacune valant un nombre de points différent
(ex. pompe sur les genoux = 1 pt, pompe normale = 2 pts, pompe claquée = 3 pts).

Un seul membre de l'équipe peut réaliser une variante à la fois, mais les 3 membres doivent realiser
au moins 5 repetitions de chaque exercice.

Pour une equipe il y a 3 **arbitres** — participants eux-mêmes — qui :
- comptent les répétitions en direct sur leur propre téléphone
- surveillent le chrono et les totals de points par exercice
- Valident ou invalide les repetition en fonction de la forme. (ces arbitres la sont
selectionés a l'avance comme apte a juger les exercices)


## 2. Objectif du projet

Fournir une application permettant :

- aux **organisateurs/administrateurs** de paramétrer entièrement l'événement
  en autonomie (équipes, épreuves, variantes, points, objectifs, arbitres)

- aux **arbitres** de compter les répétitions de façon simple, fiable et
  quasi infaillible, même dans des conditions dégradées (réseau instable,
  téléphones hétérogènes, stress du jour J) ; une synchronisation **temps réel** et fiable des scores et des temps entre
  tous les arbitres et l'administration.

La fiabilité et la résilience sont important : **le jour J, aucune
donnée ne doit être perdue et l'appli ne doit pas planter.**

## 3. Vocabulaire métier

| Terme | Définition                                                                                                                                                                                 |
|---|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Événement** | OW (Olympic warriors) L'événement sportif dans son ensemble (une édition donnée).                                                                                                          |
| **Équipe** | Groupe de participants, avec un nom. **3 participants par equipe pour tout l'événement**                                                                                                   |
| **Membre** | Un participant au sein d'une équipe. Peut aussi être désigné arbitre sur une autre équipe.                                                                                                 |
| **Épreuve / Catégorie** | Un exercice (pompes, tractions, ...) avec un objectif de points à atteindre. Chronométrée : le chrono de l'équipe démarre quand elle est prête et s'arrête dès que l'objectif est atteint. |
| **Variante** | Déclinaison d'un exercice, avec un nombre de points par répétition. Le **nombre de variantes est paramétrable** (pas fixé à 3).                                                            |
| **Score** | Total de points cumulés par une équipe sur une épreuve — somme des contributions de chaque membre, comptées indépendamment par leur arbitre respectif.                                     |
| **Temps** | Durée entre le démarrage du chrono d'une équipe et l'instant précis où l'objectif de points est atteint. C'est la donnée qui sert au classement.                                           |
| **Classement épreuve** | Équipes triées par temps croissant sur une épreuve donnée.                                                                                                                                 |
| **Classement général** | Somme des temps de chaque équipe sur toutes les épreuves. Le total le plus faible gagne.                                                                                                   |

## 4. Rôles utilisateurs

- **Administrateur / Organisateur** : configure tout (§5), désigne qui peut
  arbitrer, planifie les affectations, supervise l'événement. Ils participent aussi generalement.
- **Arbitre/participant** : compte les répétitions pour **un membre précis** d'une
  équipe, sur une épreuve donnée. Jusqu'à **3 arbitres en simultané** sur la
  même équipe (un par membre), chacun comptant indépendamment.
- **Public / spectateurs** : pas d'écran dédié prévu pour l'instant.

## 5. Fonctionnalités

### 5.1 Espace Admin

- Gestion des équipes : création, nom, composition, taille fixée pour l'événement.
- Gestion des épreuves/catégories d'exercice : nom, ordre, objectif de points.
- Gestion des variantes par épreuve : nom, valeur en points, nombre variable, ordre d'affichage.
- Gestion des arbitres : qui est habilité à arbitrer la forme, affectation à l'avance.
- Le deroulement (quelle equipe passe en premiere et repartition de arbitres) doit etre decidé sur place
et doit pouvoir etre tiré au sort. Par exemple l'equipe 2, 3 et 6 passent en premier, puis 1 et 4, puis 7 et 5. Les arbitres sont 
alors selectionnés parmis les equipes qui ne passent pas en ce moment. Une equipe a 3 arbitres de 3 equipes differentes avec au moins 1 arbitre de forme.
Ces affectations doivent pouvoir etre echangées sur le moment au cas ou. 

J'aimerai que l'UI/UX soient proche de n8n, des outils no-codes, de l'application 'Miro'. Un grand espace avec le visuel
produit et une interface epurée. Pour chaque bouton et chaque fonctionalité, il faut ce demandé si on en a vraiment besoin maintenant.
Je veux un produit clair, sobre et moderne.

### 5.2 Espace Arbitre

- Connexion via un compte léger (nom + code court), sans mot de passe complexe
- Après connexion : affichage **uniquement de son affectation du moment**
  (équipe + membre + épreuve), pas de sélection manuelle.
- Pour le compteur, comptage **tap par tap** : un bouton par variante, gros, feedback immédiat. vu sur le chrono en petit. **Undo** de la dernière action + historique complet consultable
- Pour le chronometreur, un chrono et une bonne vision sur les score en live.
- Fonctionnement **offline-first** : les taps sont mis en file d'attente
  localement si le réseau tombe, puis synchronisés automatiquement dès que
  la connexion revient, sans perte ni doublon.
- Affichage du score courant de l'équipe et de l'objectif restant.

Coté UI/UX j'ai fait 2 maquettes type exemple de screen. 

### 5.3 Écran public

Une idée _ peutetre pour la V2 _ serai d'avoir une vu tres graphique du deroulement. Comme une petite course avec toute les equipes en live sur une minute. On se sert des logs de comptage de rep pour mettre cote a cote les equipes et voir s'il y a eu des remontada, des stomp, des cote a cote, etc

## 6. Exigences non-fonctionnelles (critiques)

- **Fiabilité** : aucune perte de comptage, même en cas de coupure réseau,
  fermeture accidentelle de l'onglet, crash navigateur, etc.
- **Résilience réseau (offline-first)** : chaque arbitre compte moins de 20
  appareils simultanés au total sur l'événement, mais chacun doit pouvoir
  continuer à compter hors-ligne et resynchroniser sans perte. Attention
  particulière : le **timestamp exact** de fin d'épreuve (objectif atteint)
  doit rester fiable même si des taps arrivent en différé depuis un mode
  offline (horodatage côté client à l'action, pas à la réception serveur).
- **Temps réel** : mise à jour quasi instantanée des scores/temps pour tous
  les arbitres et l'admin (WebSocket, voir §7).
- **Simplicité d'usage (UX)** : zéro ambiguïté pour un arbitre sous pression,
  sur un téléphone qu'il découvre peut-être le jour même.
- **Multi-device** : PWA installable, utilisable sur n'importe quel
  smartphone/navigateur récent, sans store d'application.
- **Autonomie de configuration** : les organisateurs paramètrent tout sans
  intervention technique, mais la config est verrouillée une fois
  l'événement démarré.
- **Disponibilité** : une redondance serveur (bascule vers un second serveur
  en cas de panne) est envisagée par l'organisateur — modalités à définir
  (voir §9).

## 7. Stack technique

- **Frontend** : comme tu veux mais j'aime bien svelte + TypeScript, PWA.
- **Backend** : Pareil tu decide mais Fastify + TypeScript me parait correct.
- **Temps réel** : WebSocket.
- **Base de données** : PostgreSQL.
- **Conteneurisation** : Docker.
- **Déploiement** : on-premise, derrière Traefik (reverse proxy / TLS),
  accessible via un nom de domaine public en HTTPS. (je m'occuperai du deployement et tout tkt)
