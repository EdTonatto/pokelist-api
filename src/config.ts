import { z } from 'zod';
export const env = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(10000),
  FRONTEND_URL: z.string().url(),
  CORS_ORIGIN: z.string().url(),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  TCGDEX_BASE_URL: z.string().url().default('https://api.tcgdex.net/v2')
}).parse(process.env);
