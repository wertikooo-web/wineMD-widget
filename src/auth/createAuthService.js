import { AuthService } from './AuthService.js';
export function createAuthService(config) {
  return new AuthService({ usersFile: config.authUsersFile, secretFile: config.authSecretFile, sessionTtlSeconds: config.authSessionTtlSeconds, secureCookies: config.authSecureCookies });
}
