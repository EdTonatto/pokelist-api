# PokeList API

Independent TypeScript/Fastify backend for [PokeList](https://github.com/EdTonatto/pokelist), deployed on Render with PostgreSQL + Render Key Value (Redis/Valkey-compatible).

## Development

1. Copy `.env.example` to `.env` and choose a random JWT secret (32+ characters).
2. `docker compose up -d`
3. `npm install && npx prisma generate`
4. `npx prisma migrate dev --name init` (first local development run; **commit generated migrations before production deploy**)
5. `npm run dev`

API: `http://localhost:10000`; health: `/health`; readiness: `/ready`.

## Deploy on Render

`render.yaml` describes one free web service, one free PostgreSQL database, and one free Key Value cache. Connect this repository in Render → New Blueprint. Provide `RESEND_API_KEY` and `MAIL_FROM` with a verified sender/domain. For production, `FRONTEND_URL` and `CORS_ORIGIN` are configured for GitHub Pages. Database migrations must be generated and committed before first deployment. The configured preDeployCommand may not run on free web services: if unavailable, change start command to `npx prisma migrate deploy && npm start` (with migration failure stopping startup). Avoid running schema updates during uncoordinated rolling deploys.

**Free plan risks**: Render free PostgreSQL expires after 30 days; no managed backups. Do not store irreplaceable user data on a free database. Free web service sleeps when idle; cold starts affect login/requests. Free Key Value is volatile and size-limited: losing cache is expected. Upgrading PostgreSQL and setting backups is required before real use.

## Auth

- `POST /api/v1/auth/register` → `{displayName,email,password}`; sends verification email.
- `POST /api/v1/auth/verify-email` → `{token}`
- `POST /api/v1/auth/login` → `{email,password}` → short-lived bearer access token + HttpOnly refresh cookie.
- `POST /api/v1/auth/refresh`; `POST /api/v1/auth/logout` require browser Origin matching CORS_ORIGIN.
- `POST /api/v1/auth/forgot-password` → `{email}`; `POST /api/v1/auth/reset-password` → `{token,password}`.
- Other endpoints require `Authorization: Bearer <accessToken>`, except catalog reads.

The frontend lives on github.io while Render runs on a different site: third-party refresh cookies may be blocked. For reliable sessions, plan a shared custom domain. Do not store tokens in localStorage.

## Catalog and cache

`/api/v1/cards?name=Pikachu`; `/api/v1/cards/printed-number?localId=01&total=98`; `/api/v1/sets`; `/api/v1/sets/:id`; `/api/v1/sets/:id/cards`. TCGdex upstream responses are cached in Key Value with TTL; downtime in Redis falls back to the provider.

## Gaps before production

- Commit generated Prisma migrations, install a lockfile, run CI and integration tests with Postgres/Redis.
- Test TCGdex search/filter semantics and printed-number candidate coverage against live fixtures.
- Configure Resend domain and frontend auth pages, HTTPS cookie/CORS behavior, and a backup policy.
- Add coordinated verification/token issuance transaction handling, abuse-resistant distributed login limits and observability.
- This repository does **not** provision resources on your Render account automatically; sync the Blueprint in Render.


## Logs e observabilidade

A API envia logs JSON para stdout/stderr, capturados automaticamente no painel Render → pokelist-api → Logs. Defina `LOG_LEVEL=info` (padrão), ou `debug` temporariamente para eventos de cache (hit/miss/erros). Cada operação HTTP inclui `event`, rota parametrizada, método, status, duração e `requestId`. Eventos de negócio incluem autenticação, operações em listas e consultas de catálogo. Os logs **não incluem** corpo de requisições, e-mail, senha, tokens, authorization/cookies, parâmetros de busca nem chaves completas do Redis. Restrições de volume e retenção obedecem ao plano Render; não há tabela de auditoria permanente no PostgreSQL.
