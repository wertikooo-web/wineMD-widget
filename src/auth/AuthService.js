import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const b64url = value => Buffer.from(value).toString('base64url');
const jsonB64 = value => b64url(JSON.stringify(value));

async function scrypt(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (e, key) => e ? reject(e) : resolve(key)));
}

export class AuthService {
  constructor({ usersFile, secretFile, sessionTtlSeconds = 8 * 60 * 60, secureCookies = false, clock = () => Date.now() }) {
    this.usersFile = usersFile;
    this.secretFile = secretFile;
    this.sessionTtlSeconds = sessionTtlSeconds;
    this.secureCookies = secureCookies;
    this.clock = clock;
    this.secret = null;
  }

  async ensureStorage() {
    await fs.mkdir(path.dirname(this.usersFile), { recursive: true });
    await fs.mkdir(path.dirname(this.secretFile), { recursive: true });
    try { this.secret = (await fs.readFile(this.secretFile, 'utf8')).trim(); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.secret = crypto.randomBytes(48).toString('base64url');
      await fs.writeFile(this.secretFile, `${this.secret}\n`, { mode: 0o600, flag: 'wx' });
    }
    try { await fs.access(this.usersFile); }
    catch { await fs.writeFile(this.usersFile, '[]\n', { mode: 0o600, flag: 'wx' }); }
  }

  async users() { await this.ensureStorage(); return JSON.parse(await fs.readFile(this.usersFile, 'utf8')); }
  async hasUsers() { return (await this.users()).length > 0; }

  normalizeEmail(email) { return String(email ?? '').trim().toLowerCase(); }
  validatePassword(password) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
      const e = new Error('Пароль должен содержать от 12 до 200 символов.'); e.code = 'WEAK_PASSWORD'; throw e;
    }
  }

  async createFirstAdmin({ email, password, name = 'Администратор' }) {
    const users = await this.users();
    if (users.length) { const e = new Error('Первый администратор уже создан.'); e.code = 'SETUP_COMPLETE'; throw e; }
    email = this.normalizeEmail(email);
    if (!/^\S+@\S+\.\S+$/.test(email)) { const e = new Error('Введите корректный email.'); e.code = 'INVALID_EMAIL'; throw e; }
    this.validatePassword(password);
    const salt = crypto.randomBytes(16).toString('base64url');
    const hash = (await scrypt(password, salt)).toString('base64url');
    const user = { id: crypto.randomUUID(), email, name: String(name).trim().slice(0, 100) || 'Администратор', role: 'admin', salt, passwordHash: hash, createdAt: new Date(this.clock()).toISOString(), active: true };
    await fs.writeFile(this.usersFile, `${JSON.stringify([user], null, 2)}\n`, { mode: 0o600 });
    return this.publicUser(user);
  }

  async authenticate(email, password) {
    email = this.normalizeEmail(email);
    const user = (await this.users()).find(x => x.email === email && x.active !== false);
    const fallbackSalt = 'invalid-login-salt';
    const candidate = await scrypt(String(password ?? ''), user?.salt ?? fallbackSalt);
    const expected = Buffer.from(user?.passwordHash ?? Buffer.alloc(64).toString('base64url'), 'base64url');
    if (!user || expected.length !== candidate.length || !crypto.timingSafeEqual(expected, candidate)) return null;
    return this.publicUser(user);
  }

  publicUser(user) { return { id: user.id, email: user.email, name: user.name, role: user.role }; }

  signSession(user) {
    if (!this.secret) throw new Error('AuthService is not initialized');
    const now = Math.floor(this.clock() / 1000);
    const header = jsonB64({ alg: 'HS256', typ: 'JWT' });
    const payload = jsonB64({ sub: user.id, email: user.email, name: user.name, role: user.role, iat: now, exp: now + this.sessionTtlSeconds });
    const body = `${header}.${payload}`;
    const sig = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verifySession(token) {
    try {
      if (!this.secret || typeof token !== 'string') return null;
      const [header, payload, signature, extra] = token.split('.');
      if (!header || !payload || !signature || extra) return null;
      const body = `${header}.${payload}`;
      const expected = crypto.createHmac('sha256', this.secret).update(body).digest();
      const actual = Buffer.from(signature, 'base64url');
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (claims.exp <= Math.floor(this.clock() / 1000) || claims.role !== 'admin') return null;
      return { id: claims.sub, email: claims.email, name: claims.name, role: claims.role };
    } catch { return null; }
  }

  cookie(token) {
    return `winemd_admin_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${this.sessionTtlSeconds}${this.secureCookies ? '; Secure' : ''}`;
  }
  clearCookie() { return `winemd_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.secureCookies ? '; Secure' : ''}`; }
}

export function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(v => v.trim()).filter(Boolean).map(pair => {
    const i = pair.indexOf('='); return i < 0 ? [pair, ''] : [pair.slice(0, i), decodeURIComponent(pair.slice(i + 1))];
  }));
}
