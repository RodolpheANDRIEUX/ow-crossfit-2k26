import { scopedKey } from './scope.ts';

/** Invite d'installation Chrome/Android (pas encore standardisee). */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const BYPASS_KEY = scopedKey('ow.browser-mode');

function standalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isPhone(): boolean {
  if (typeof navigator === 'undefined') return false;
  // Un ecran tactile etroit : c'est le telephone d'un arbitre, pas le poste
  // de l'organisation.
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse && Math.min(window.innerWidth, window.innerHeight) < 820;
}

function isApple(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Etat d'installation de l'application.
 *
 * Point important decouvert en test : Chrome n'installe une application que
 * depuis une origine **securisee** (https, ou localhost). En http sur une IP
 * locale, le service worker est refuse, l'application n'est jamais
 * « installable », et « creer un raccourci » ne fabrique qu'un marque-page qui
 * rouvre le navigateur. On le detecte et on le dit, plutot que de laisser
 * l'utilisateur devant un bouton qui ne fait rien.
 */
class Pwa {
  /** Chrome a signale que l'installation est possible. */
  ready = $state(false);
  installed = $state(standalone());
  /** L'arbitre a choisi de rester dans le navigateur. */
  bypassed = $state(readBypass());
  phone = isPhone();
  apple = isApple();
  secure = typeof window === 'undefined' ? true : window.isSecureContext;
  serviceWorkerOk = $state<boolean | null>(null);

  #prompt: InstallPrompt | null = null;

  constructor() {
    if (typeof window === 'undefined') return;

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault(); // on declenche l'invite depuis notre propre bouton
      this.#prompt = event as InstallPrompt;
      this.ready = true;
    });

    window.addEventListener('appinstalled', () => {
      this.ready = false;
      this.installed = true;
    });

    window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', (e) => {
      this.installed = e.matches;
    });

    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => (this.serviceWorkerOk = Boolean(reg)))
        .catch(() => (this.serviceWorkerOk = false));
    } else {
      this.serviceWorkerOk = false;
    }
  }

  /** Pourquoi l'installation n'est-elle pas proposee ? */
  get state(): 'installed' | 'ready' | 'insecure' | 'apple' | 'waiting' {
    if (this.installed) return 'installed';
    if (this.ready) return 'ready';
    if (!this.secure) return 'insecure';
    if (this.apple) return 'apple';
    return 'waiting';
  }

  async install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!this.#prompt) return 'unavailable';
    await this.#prompt.prompt();
    const { outcome } = await this.#prompt.userChoice;
    if (outcome === 'accepted') this.ready = false;
    this.#prompt = null;
    return outcome;
  }

  continueInBrowser(): void {
    this.bypassed = true;
    try {
      localStorage.setItem(BYPASS_KEY, '1');
    } catch {
      // sans stockage, l'ecran se represente au prochain lancement
    }
  }
}

function readBypass(): boolean {
  try {
    return localStorage.getItem(BYPASS_KEY) === '1';
  } catch {
    return false;
  }
}

export const pwa = new Pwa();
