import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';

export type Principal =
  | { role: 'admin' }
  | { role: 'judge'; memberId: string; name: string };

const b64 = (buf: Buffer) => buf.toString('base64url');

function sign(payload: string): string {
  return b64(createHmac('sha256', config.authSecret).update(payload).digest());
}

/** Jeton auto-porte signe HMAC : aucun stockage de session, resiste au redemarrage. */
export function issueToken(principal: Principal): string {
  const payload = b64(Buffer.from(JSON.stringify({ ...principal, iat: Date.now() })));
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined | null): Principal | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.role === 'admin') return { role: 'admin' };
    if (data.role === 'judge' && typeof data.memberId === 'string') {
      return { role: 'judge', memberId: data.memberId, name: String(data.name ?? '') };
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/** Codes lisibles : ni 0/O ni 1/I, pour eviter les erreurs de saisie le jour J. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode(length = 4): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}
