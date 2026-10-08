import type { FastifyBaseLogger } from 'fastify';

import type { AppConfig } from '../config.js';
import type { BaseClient } from '../db/client.js';
import type { JwtService } from '../security/jwt.js';
import type { PasswordHasher } from '../security/password.js';

import type { Mailer } from './mailer.js';

export interface AuthDeps {
  cfg: AppConfig;
  base: BaseClient;
  jwt: JwtService;
  hasher: PasswordHasher;
  mailer: Mailer;
  log: FastifyBaseLogger;
}

export interface RequestMeta {
  ip: string;
  requestId: string;
  userAgent?: string | undefined;
}
