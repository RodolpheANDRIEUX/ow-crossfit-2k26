function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback === undefined) throw new Error(`Variable d'environnement manquante : ${name}`);
    return fallback;
  }
  return value;
}

export const config = {
  port: Number(env('PORT', '3000')),
  host: env('HOST', '0.0.0.0'),
  databaseUrl: env('DATABASE_URL', 'postgres://ow:ow@localhost:5432/ow'),
  authSecret: env('AUTH_SECRET', 'dev-secret-change-me'),
  adminCode: env('ADMIN_CODE', 'OW2026').toUpperCase(),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:5173'),
  /** Dossier du front compile, servi par le serveur en production. */
  publicDir: env('PUBLIC_DIR', 'public'),

  /**
   * Certificat TLS optionnel.
   *
   * En production, c'est Traefik qui termine le TLS et ces variables restent
   * vides. Elles servent a tester l'installation de la PWA sur un telephone en
   * reseau local : sans https, Chrome refuse le service worker et
   * l'application n'est jamais installable.
   */
  tlsCert: process.env.TLS_CERT ?? '',
  tlsKey: process.env.TLS_KEY ?? '',
};
