export type Theme = 'dark' | 'light';

const KEY = 'ow.theme';

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function apply(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f4f5f7' : '#111214');
}

/**
 * Theme de l'appareil. Le theme clair sert en plein soleil ; il est memorise
 * sur le telephone, pas sur le compte.
 */
class ThemeStore {
  current = $state<Theme>(read());

  constructor() {
    apply(this.current);
  }

  toggle(): void {
    this.current = this.current === 'dark' ? 'light' : 'dark';
    apply(this.current);
    try {
      localStorage.setItem(KEY, this.current);
    } catch {
      // sans stockage, le theme vaut pour la session
    }
  }
}

export const theme = new ThemeStore();
