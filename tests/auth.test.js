import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { AuthService } from '../src/auth/AuthService.js';

test('first admin setup hashes password and creates verifiable session', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'winemd-auth-'));
  const auth = new AuthService({ usersFile: path.join(dir, 'users.json'), secretFile: path.join(dir, 'secret.key') });
  await auth.ensureStorage();
  const user = await auth.createFirstAdmin({ email: 'Admin@Wine.md', password: 'correct horse battery staple', name: 'Alex' });
  assert.equal(user.email, 'admin@wine.md');
  const raw = await fs.readFile(path.join(dir, 'users.json'), 'utf8');
  assert.equal(raw.includes('correct horse battery staple'), false);
  assert.equal((await auth.authenticate('admin@wine.md', 'correct horse battery staple')).role, 'admin');
  assert.equal(await auth.authenticate('admin@wine.md', 'wrong password'), null);
  const token = auth.signSession(user);
  assert.equal(auth.verifySession(token).email, 'admin@wine.md');
  assert.match(auth.cookie(token), /HttpOnly/);
  assert.match(auth.cookie(token), /SameSite=Strict/);
});

test('second bootstrap admin is rejected', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'winemd-auth-'));
  const auth = new AuthService({ usersFile: path.join(dir, 'users.json'), secretFile: path.join(dir, 'secret.key') });
  await auth.createFirstAdmin({ email: 'a@example.com', password: 'a very secure password' });
  await assert.rejects(() => auth.createFirstAdmin({ email: 'b@example.com', password: 'another secure password' }), e => e.code === 'SETUP_COMPLETE');
});

test('expired and tampered sessions are rejected', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'winemd-auth-'));
  let now = Date.now();
  const auth = new AuthService({ usersFile: path.join(dir, 'users.json'), secretFile: path.join(dir, 'secret.key'), sessionTtlSeconds: 900, clock: () => now });
  await auth.ensureStorage();
  const user = { id: '1', email: 'admin@wine.md', name: 'Admin', role: 'admin' };
  const token = auth.signSession(user);
  assert.equal(auth.verifySession(`${token}x`), null);
  now += 901000;
  assert.equal(auth.verifySession(token), null);
});
