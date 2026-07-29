# My Anime Catalog — v1 Design

**Date:** 2026-07-29
**Status:** Approved (design), pending spec review
**Author:** Muffing21 (personal project)

## Purpose

A personal anime catalog/tracker in the spirit of MyAnimeList, built as a
**backend learning project**. Users register, search anime, and maintain a
personal list with watch status, score, and progress. The long-term vision is
to add an Anime-Music-Quiz–style game later; v1 does **not** build the game,
but the data model leaves the door open for it.

This is a learning project: the goal is to practice backend fundamentals
(raw SQL, sessions, a read-through cache over a third-party API) inside the
folder/layering conventions of the author's existing `chat-api` project.

## Goals

- Register / login / logout with **cookie sessions**.
- Search anime via the **AniList** API.
- Cache anime metadata locally (**read-through cache**) so list views never hit
  AniList and we stay under its rate limit.
- Full CRUD on a personal list (status / score / progress), scoped to the owner.
- View own list with filtering (by status) and sorting.

## Non-Goals (v1)

- The quiz / music game (comes last; only the anime cache leaves room for it).
- Social features (following, comments, public profiles).
- Syncing to real MyAnimeList / AniList accounts (no OAuth writeback).
- Theme-song data (backfillable from AniList later without a painful migration).

## Key Decisions

| Area | Decision | Rationale |
|---|---|---|
| Language | TypeScript | Matches `chat-api`. |
| Framework | Express | Matches `chat-api`. |
| DB | PostgreSQL | Data is inherently relational (users → list_entries → anime). |
| DB access | **Pure raw SQL** via `pg` | Deliberate deviation from `chat-api` (which uses Sequelize). The point of the project is to learn SQL: hand-written JOINs, constraints, indexes. No ORM, no decorator models. |
| Auth | **Cookie sessions** | Deliberate deviation from `chat-api` (JWT). Correct fit for a same-site website; teaches cookies + server-side session lifecycle + revocation. HTTP-only cookie, session rows in Postgres. |
| Validation | **zod** | Deviation from `chat-api`'s `express-validator`. With no ORM there are no generated types; zod gives runtime validation **and** an inferred TS type from one schema, which flows into services and SQL params. Author already knows it. |
| Password hashing | bcrypt | Simple, battle-tested. |
| External data | AniList (cached locally) | Rich metadata incl. theme songs (for the future game); ~90 req/min limit dictates the caching architecture. |
| Structure | `pkg/<feature>/` layering | Matches `chat-api` (see below). |
| Repo | Personal, **private** GitHub (`Muffing21`) | Personal learning project; must NOT use the work identity that is the machine's git default. |

### What "match `chat-api`" means here

Matched: TypeScript + Express, `pkg/<feature>/` feature folders each with
`.controller.ts` / `.service.ts` / `.router.ts` (+ `.cache.ts` where relevant),
controller handlers as **named function exports**, services as **object
exports** (`export const listService = { ... }`), an `ApiError` class in
`types/`, an `error.middleware.ts`, per-route middleware declared inline in each
router file, and `config/` + `utils/` folders.

Deviated (deliberately): `chat-api`'s Sequelize `models/` layer is replaced by a
raw-SQL `db/` layer; JWT is replaced by cookie sessions; `express-validator` is
replaced by zod.

## Architecture

Three clear layers per feature, plus a single outbound-API module:

- **controllers** — HTTP only: parse/validate input (via zod), call a service,
  shape the response, forward errors to `next(ApiError...)`.
- **services** — business logic + **all SQL**. Object exports.
- **`services/anilist.service.ts`** — the ONLY code that talks to AniList (axios).
  Everything else depends on our own DB. (Top-level `services/`, matching
  `chat-api`'s integration-service convention.)
- **`db/`** — the `pg` pool, a small `query()` helper, and numbered `.sql`
  migration files applied by a tiny runner.

Boundary test: each unit can be described by what it does, how it's used, and
what it depends on, and can be understood without reading the others' internals.

## Folder Structure

Mirrors `chat-api`'s layout: everything lives at the **project root** (no `src/`
wrapper), feature code under `pkg/<feature>/`, cross-cutting external
integrations under a top-level `services/` folder (the same place `chat-api`
puts `services/oracle/*.service.ts`).

```
app.ts                        # express setup, middleware, route mounting, error handler (root, like chat-api)
config/
  constants.config.ts         # env: PORT, DB creds, SESSION_SECRET, COOKIE opts, ANILIST_URL
  db.config.ts                # pg Pool + connect() + query() helper
  cache.config.ts             # optional: in-memory/redis TTL layer for anime cache
db/                           # replaces chat-api's Sequelize models/ + sync(): raw-SQL schema lives here
  migrations/                 # 0001_init.sql, ... (schema + indexes + constraints)
  migrate.ts                  # applies migrations in order, tracks applied ones
middleware/
  auth.middleware.ts          # authHandler: reads session cookie -> req.user; else ApiError.unauthorized
  error.middleware.ts         # errorHandler + errorRoute (ported from chat-api)
types/
  api-error.ts                # ApiError class (ported from chat-api)
  express/index.d.ts          # augment Express Request with req.user
utils/
  password.helper.ts          # bcrypt hash/compare
  session.helper.ts           # create / lookup / destroy session rows; cookie helpers
  pagination.helper.ts
services/                     # top-level integration services, like chat-api's services/oracle/
  anilist.service.ts          # the ONLY code that calls AniList (axios): search + fetch-by-id, normalized
pkg/
  healthcheck/
    healthcheck.router.ts
  auth/
    auth.controller.ts  auth.service.ts  auth.router.ts
  anime/
    anime.controller.ts anime.service.ts anime.cache.ts anime.router.ts
  list/
    list.controller.ts  list.service.ts  list.router.ts
```

Note: `chat-api` has no migration files (it relies on Sequelize `sync()`). Since
we use raw SQL, the top-level `db/` folder is a deliberate, necessary addition —
it is the raw-SQL replacement for `chat-api`'s `models/` layer, kept at the root
to stay consistent with the flat, root-level convention.

## Data Model (raw SQL — `db/migrations/*.sql`)

**`users`**
- `id uuid PK default uuid_generate_v4()`
- `username text UNIQUE NOT NULL`
- `email text UNIQUE NOT NULL`
- `password_hash text NOT NULL`
- `created_at timestamptz NOT NULL default now()`

**`sessions`** (server-side session store)
- `id uuid PK default uuid_generate_v4()` — the value stored in the cookie
- `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `expires_at timestamptz NOT NULL`
- `created_at timestamptz NOT NULL default now()`
- index on `user_id`; logout = delete the row; expiry checked on each request.

**`anime`** (read-through cache of AniList data)
- `id uuid PK default uuid_generate_v4()`
- `anilist_id integer UNIQUE NOT NULL`
- `title_romaji text`, `title_english text`, `title_native text`
- `cover_image_url text`, `banner_image_url text`
- `synopsis text`
- `episode_count integer`
- `format text`, `status text`
- `season text`, `year integer`
- `average_score integer`
- `genres jsonb`
- `cached_at timestamptz NOT NULL default now()`

**`list_entries`** (the heart of the product — user-owned)
- `id uuid PK default uuid_generate_v4()`
- `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `anime_id uuid NOT NULL REFERENCES anime(id)`
- `status text NOT NULL CHECK (status IN ('watching','completed','on_hold','dropped','plan_to_watch'))`
- `score integer CHECK (score BETWEEN 1 AND 10)` (nullable)
- `progress integer NOT NULL default 0`
- `started_at date`, `finished_at date`, `notes text`
- `created_at timestamptz NOT NULL default now()`
- `updated_at timestamptz NOT NULL default now()` — with no ORM, this does **not**
  update itself; `list.service` sets `updated_at = now()` explicitly in every
  UPDATE statement (chosen over a DB trigger to keep all logic visible in the
  service, matching the raw-SQL learning goal).
- **`UNIQUE (user_id, anime_id)`** — one entry per anime per user
- index on `user_id` (list views filter by owner)

Requires the `uuid-ossp` extension (`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`),
as in `chat-api`.

## Read-Through Cache Flow

1. **Search** — `GET /anime/search?q=` → `anime.service.search` →
   `services/anilist.service` queries AniList live (search is broad and not
   cacheable per-id). Results are returned for display; nothing is necessarily
   persisted yet.
2. **Add to list** — `POST /list` with an `anilistId` → `anime.service` looks up
   `anime` by `anilist_id`:
   - **hit** → use existing local `anime.id`.
   - **miss** → `services/anilist.service` fetches that one anime → normalize into
     our columns → `INSERT` → use the new local `anime.id`.
3. **View one anime** — `GET /anime/:anilistId` → `anime.service` looks up by
   `anilist_id`; **hit** serves from our DB, **miss** fetches that one anime from
   AniList, normalizes, inserts, and returns it. This is the third (and final)
   code path that can call AniList.
4. `list_entries.anime_id` references the **local** `anime.id`. Therefore list
   views (`GET /list`) JOIN `list_entries` → `anime` locally and never call
   AniList. This is what keeps us under the rate limit.
5. `cached_at` allows an optional future refresh policy (not implemented in v1).

The three (and only three) code paths that reach AniList: search, add-to-list on
cache miss, and view-one-anime on cache miss.

## Authentication (cookie sessions)

- `POST /auth/register` — validate (zod), ensure username/email unique, bcrypt-hash
  the password, insert `users` row. Does not auto-login (or optionally does — see
  Open Questions).
- `POST /auth/login` — look up by username/email, `bcrypt.compare`, on success
  insert a `sessions` row and `Set-Cookie` an HTTP-only, `SameSite=Lax`,
  `Secure` (in prod) cookie holding the session id, with a matching `Max-Age`.
- `POST /auth/logout` — delete the session row, clear the cookie.
- `GET /auth/me` — returns the current user (auth required).
- **`authHandler` middleware** — read the session cookie, look up the row, reject
  if missing/expired (`ApiError.unauthorized`), else attach `req.user` and
  continue. Declared inline per protected route in the router files.

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | — | liveness |
| POST | `/api/v1/auth/register` | — | create account |
| POST | `/api/v1/auth/login` | — | create session, set cookie |
| POST | `/api/v1/auth/logout` | ✓ | destroy session |
| GET | `/api/v1/auth/me` | ✓ | current user |
| GET | `/api/v1/anime/search?q=` | — | AniList-backed search |
| GET | `/api/v1/anime/:anilistId` | — | one anime from local cache (fetch-on-miss) |
| GET | `/api/v1/list?status=&sort=` | ✓ | my list, filter/sort |
| POST | `/api/v1/list` | ✓ | add anime to my list (`anilistId`, status, ...) |
| PATCH | `/api/v1/list/:animeId` | ✓ | update status / score / progress |
| DELETE | `/api/v1/list/:animeId` | ✓ | remove entry |

### Identifier conventions (which id each route uses)

Two id spaces exist and must not be confused:

- **AniList id** (`anilist_id`, integer) — how the outside world / search results
  refer to an anime. Used by routes that may need to *fetch on miss*:
  `GET /api/v1/anime/:anilistId` and the `anilistId` field in the `POST /list`
  body. If the anime isn't cached locally, we can fetch it from AniList by this id.
- **Local `anime.id`** (uuid) — our internal primary key that `list_entries`
  references. Used to address an **existing** list entry the client already holds:
  `:animeId` in `PATCH /api/v1/list/:animeId` and `DELETE /api/v1/list/:animeId`
  is the local `anime.id` uuid (the anime is guaranteed to be cached by then,
  because you can only PATCH/DELETE an entry that was already added).

## Error Handling

- `ApiError` class (`badRequest`/`unauthorized`/`forbidden`/`notFound`/`internal`)
  ported from `chat-api`; controllers forward via `next(ApiError...)`.
- `error.middleware.ts`: `errorHandler` maps `ApiError` → `{ code, error }`,
  unknown errors → 500; `errorRoute` handles unmatched routes as 404.
- **Ownership** enforced in `list.service`: every list operation is scoped to
  `req.user.id`; a user can never read or mutate another user's entries.
- **AniList failures/timeouts** → caught in `services/anilist.service` / `anime.service` and
  surfaced as `ApiError.internal`/502-style; a third-party outage never crashes a
  request.
- Zod validation errors → `ApiError.badRequest` with a readable message.

## Testing

Learning-appropriate but real: **integration tests** hitting the Express app
against a **test Postgres database**, with `services/anilist.service.ts` **mocked** (no live
network in tests). Focus on the parts with real logic:

- Read-through cache: cache **hit** vs **miss** (miss triggers one AniList fetch +
  insert; hit triggers none).
- List CRUD + **ownership** (user A cannot touch user B's entries).
- Auth: register → login sets cookie → protected route works → logout invalidates.

## Project Setup (to be detailed in the implementation plan)

The implementation plan MUST include full project setup, not just feature code:

1. Node + TypeScript project init with **yarn** (matches `chat-api`:
   `package.json`, `tsconfig.json`, `nodemon`, `ts-node`, `yarn.lock`), and yarn
   scripts `dev` / `build` / `start` / `migrate` / `test`.
2. Dependencies: `express`, `pg`, `bcrypt`, `zod`, `cookie-parser`, `helmet`,
   `cors`, `morgan`, `dotenv`, `axios`; dev: `typescript`, `@types/*`, `nodemon`,
   `ts-node`, `vitest` (test runner).
3. Local Postgres via `docker-compose.yml` (matches `chat-api`'s docker usage),
   plus `.env` / `.env.example` (never commit real secrets).
4. `db/migrate.ts` runner + `0001_init.sql` (schema above).
5. Port `ApiError` + `error.middleware.ts` conventions from `chat-api`.
6. `.gitignore` (node_modules, dist, .env).
7. **GitHub**: local git identity already set to personal (`Muffing21` /
   `96890792+Muffing21@users.noreply.github.com`); create a **private** repo on
   the `Muffing21` account via `gh` (switching the active `gh` account from the
   work `Harrytopgun`), and push.

## Resolved Decisions (previously Open Questions)

1. **Register does NOT auto-login.** `POST /auth/register` creates the account
   only; the client then calls `POST /auth/login` to get a session. Keeps the two
   flows clean and independent in v1.
2. **Session lifetime = 30 days.** The `sessions.expires_at` and the cookie
   `Max-Age` are both 30 days from login.
3. **Test runner = `vitest`,** run via `yarn test`. Chosen for first-class
   TypeScript support and minimal config; the yarn script name matches the
   author's `yarn`-based `chat-api` workflow.
