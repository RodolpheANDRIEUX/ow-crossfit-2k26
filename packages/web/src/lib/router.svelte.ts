import { withScope } from './scope.ts';

/** Routeur minimal : quelques ecrans, aucune dependance. */
class Router {
  path = $state(typeof location === 'undefined' ? '/' : location.pathname);

  go(next: string): void {
    if (next === this.path) return;
    history.pushState({}, '', withScope(next));
    this.path = next;
  }

  replace(next: string): void {
    history.replaceState({}, '', withScope(next));
    this.path = next;
  }
}

export const router = new Router();

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    router.path = location.pathname;
  });
}
