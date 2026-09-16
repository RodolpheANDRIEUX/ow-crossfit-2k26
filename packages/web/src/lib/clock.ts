/**
 * Horloge commune.
 *
 * Chaque tap est horodate par le telephone qui compte. Or les horloges des
 * telephones different de plusieurs secondes : sans recalage, deux arbitres
 * dateraient differemment la meme seconde de course, et l'instant de fin
 * d'epreuve serait faux.
 *
 * On mesure donc l'ecart avec l'horloge du serveur et on l'applique a tous les
 * horodatages produits ici. L'ecart est memorise : un telephone qui redemarre
 * hors-ligne continue de dater juste.
 */
import { scopedKey } from './scope.ts';

const KEY = scopedKey('ow.skew');

let skew = 0;
try {
  skew = Number(localStorage.getItem(KEY) ?? 0) || 0;
} catch {
  skew = 0;
}

/** Instant courant exprime dans le referentiel du serveur (millisecondes entieres). */
export function nowTs(): number {
  return Math.round(Date.now() + skew);
}

export function getSkew(): number {
  return skew;
}

/**
 * Recale l'horloge a partir d'une reponse serveur.
 * `sentAt`/`receivedAt` encadrent l'aller-retour : on suppose le serveur au
 * milieu, ce qui annule la moitie de la latence.
 */
export function syncClock(serverNow: number, sentAt: number, receivedAt: number): void {
  const roundTrip = receivedAt - sentAt;
  if (roundTrip < 0 || roundTrip > 5000) return; // mesure aberrante, on ignore
  const next = serverNow - (sentAt + receivedAt) / 2;
  // Lissage : on evite qu'un pic de latence fasse sauter le chrono.
  skew = Math.abs(next - skew) > 2000 ? next : skew * 0.7 + next * 0.3;
  try {
    localStorage.setItem(KEY, String(Math.round(skew)));
  } catch {
    // stockage indisponible : l'ecart reste valable pour la session
  }
}
