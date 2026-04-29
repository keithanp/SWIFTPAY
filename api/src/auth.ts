import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { config } from './config.js';

export type Authed = { developerId: string };

export async function hashApiSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyApiSecret(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(developerId: string): string {
  return jwt.sign({ sub: developerId }, config.jwtSecret, { expiresIn: '7d' });
}

export function verifyToken(token: string): { sub: string } {
  return jwt.verify(token, config.jwtSecret) as { sub: string };
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'missing_bearer' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyToken(token);
    if (!payload.sub) {
      reply.code(401).send({ error: 'invalid_token' });
      return;
    }
    (req as FastifyRequest & { auth: Authed }).auth = { developerId: payload.sub };
  } catch {
    reply.code(401).send({ error: 'invalid_token' });
  }
}

export async function assertDeveloperExists(developerId: string): Promise<boolean> {
  const r = await pool.query('select 1 from developers where id = $1', [developerId]);
  return r.rowCount === 1;
}
