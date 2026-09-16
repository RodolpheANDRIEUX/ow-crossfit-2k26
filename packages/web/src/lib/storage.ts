import type { Op } from '@ow/shared';
import { databaseName, scopedKey } from './scope.ts';

export interface StoredOp extends Op {
  /** L'operation a ete confirmee par le serveur. */
  acked: boolean;
  createdAt: number;
}

/**
 * File d'attente persistante des taps.
 *
 * Point le plus critique de l'application : un tap ecrit ici AVANT toute
 * tentative reseau. Fermeture d'onglet, crash, batterie a plat, coupure 4G —
 * les operations sont relues au demarrage et renvoyees.
 *
 * IndexedDB en principal, localStorage en secours (navigation privee, quotas),
 * memoire en dernier recours : le comptage n'est jamais bloque.
 */
interface Backend {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  all(): Promise<StoredOp[]>;
  put(ops: StoredOp[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
}

const DB_NAME = databaseName;
const STORE = 'ops';
const LS_KEY = scopedKey('ow.ops');

function indexedDbBackend(): Promise<Backend> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('pas d IndexedDB'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refuse'));
    request.onsuccess = () => {
      const db = request.result;
      const run = <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) =>
        new Promise<T>((ok, ko) => {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          req.onsuccess = () => ok(req.result);
          req.onerror = () => ko(req.error ?? new Error('IndexedDB'));
        });
      resolve({
        kind: 'indexeddb',
        all: () => run('readonly', (s) => s.getAll() as IDBRequest<StoredOp[]>),
        put: async (ops) => {
          await new Promise<void>((ok, ko) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            for (const op of ops) store.put(op);
            tx.oncomplete = () => ok();
            tx.onerror = () => ko(tx.error ?? new Error('IndexedDB'));
          });
        },
        remove: async (ids) => {
          await new Promise<void>((ok, ko) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            for (const id of ids) store.delete(id);
            tx.oncomplete = () => ok();
            tx.onerror = () => ko(tx.error ?? new Error('IndexedDB'));
          });
        },
      });
    };
  });
}

function localStorageBackend(): Backend {
  const read = (): StoredOp[] => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as StoredOp[];
    } catch {
      return [];
    }
  };
  const write = (ops: StoredOp[]) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(ops));
    } catch {
      // quota atteint : on garde au moins la memoire vive
    }
  };
  return {
    kind: 'localstorage',
    all: async () => read(),
    put: async (ops) => {
      const map = new Map(read().map((o) => [o.id, o]));
      for (const op of ops) map.set(op.id, op);
      write([...map.values()]);
    },
    remove: async (ids) => {
      const drop = new Set(ids);
      write(read().filter((o) => !drop.has(o.id)));
    },
  };
}

function memoryBackend(): Backend {
  let ops: StoredOp[] = [];
  return {
    kind: 'memory',
    all: async () => ops,
    put: async (incoming) => {
      const map = new Map(ops.map((o) => [o.id, o]));
      for (const op of incoming) map.set(op.id, op);
      ops = [...map.values()];
    },
    remove: async (ids) => {
      const drop = new Set(ids);
      ops = ops.filter((o) => !drop.has(o.id));
    },
  };
}

let backendPromise: Promise<Backend> | null = null;

export function storage(): Promise<Backend> {
  backendPromise ??= indexedDbBackend().catch(() => {
    try {
      localStorage.setItem('ow.probe', '1');
      localStorage.removeItem('ow.probe');
      return localStorageBackend();
    } catch {
      return memoryBackend();
    }
  });
  return backendPromise;
}
