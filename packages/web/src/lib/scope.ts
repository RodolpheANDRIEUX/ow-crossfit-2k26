/**
 * Cloisonnement du stockage local par session.
 *
 * Deux onglets d'un meme navigateur partagent localStorage et IndexedDB : sans
 * cela, impossible d'ouvrir deux arbitres cote a cote pour repeter le jour J.
 * Ajouter `?session=2` a l'adresse donne a l'onglet son propre espace de
 * stockage — jeton, file d'attente, cache d'affectation, tout est separe.
 *
 * Sans le parametre, le comportement est exactement celui d'avant : rien ne
 * change pour les telephones des arbitres.
 */
const raw =
  typeof location === 'undefined'
    ? ''
    : (new URLSearchParams(location.search).get('session') ?? '');

export const sessionScope = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12);

/** Suffixe une cle de stockage avec la session courante. */
export function scopedKey(key: string): string {
  return sessionScope ? `${key}#${sessionScope}` : key;
}

export const databaseName = sessionScope ? `ow-compteur-${sessionScope}` : 'ow-compteur';

/** Conserve le parametre de session lors des changements d'adresse. */
export function withScope(path: string): string {
  return sessionScope ? `${path}?session=${sessionScope}` : path;
}
