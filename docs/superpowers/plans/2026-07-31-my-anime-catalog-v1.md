# My Anime Catalog v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 backend for a MyAnimeList-style anime catalog: register/login with cookie sessions, search AniList, and CRUD a personal list, with anime metadata served from a local read-through cache.

**Architecture:** TypeScript + Express at the project root (mirroring `chat-api`), feature code under `pkg/<feature>/` split into `.controller` / `.service` / `.router`, raw SQL over a `pg` pool (no ORM), the AniList client isolated in `services/anilist.service.ts`, cookie sessions with server-side session rows in Postgres, and zod for request validation. Anime the user tracks are cached locally on first touch so list views never hit AniList.

**Tech Stack:** Node, TypeScript, Express, PostgreSQL (raw `pg`), zod, bcrypt, cookie-parser, axios, vitest, Docker Compose, yarn.

**Reference project:** `/Users/wichapas/chat-api` — port `ApiError`, `error.middleware`, and the `pkg/`/`config/`/`utils/`/`services/` conventions from it. Do NOT copy its Sequelize models or JWT auth.

**Spec:** `docs/superpowers/specs/2026-07-29-my-anime-catalog-design.md`

**Conventions for every task:**
- Controllers = named-export handler functions. Services = object exports (`export const xService = { ... }`).
- All SQL lives in services (or helpers), never in controllers.
- Domain errors use `ApiError` and are forwarded via `next(...)`; the global `errorHandler` renders them.
- Commit with the personal identity already configured locally (`Muffing21` / noreply). Every commit message ends with the trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

## File Structure

```
app.ts                          # express bootstrap, middleware, route mounting, error handlers
config/
  constants.config.ts           # typed env access: PORT, DATABASE_URL, SESSION_SECRET, cookie opts, ANILIST_URL
  db.config.ts                  # pg Pool + query() helper + connectDb()
db/
  migrations/0001_init.sql      # users, sessions, anime, list_entries + indexes
  migrate.ts                    # applies pending .sql migrations in order, tracked in schema_migrations
middleware/
  auth.middleware.ts            # authHandler: session cookie -> req.user, else ApiError.unauthorized
  error.middleware.ts           # errorHandler + errorRoute (ported from chat-api)
types/
  api-error.ts                  # ApiError class (ported from chat-api)
  express/index.d.ts            # augment Express Request with req.user
utils/
  password.helper.ts            # bcrypt hash/compare
  session.helper.ts             # create/find/destroy session rows; cookie name + options
services/
  anilist.service.ts            # ONLY caller of AniList (axios): search + fetchById, normalized
pkg/
  healthcheck/healthcheck.router.ts
  auth/  auth.controller.ts  auth.service.ts  auth.router.ts
  anime/ anime.controller.ts anime.service.ts anime.router.ts
  list/  list.controller.ts  list.service.ts  list.router.ts
tests/
  helpers/db.ts                 # test DB reset helper
  setup.ts                      # vitest global setup: run migrations on the test DB
  *.test.ts                     # integration + unit tests
docker-compose.yml              # local + test Postgres
.env.example                    # documented env template (committed)
.env                            # real values (gitignored)
tsconfig.json  vitest.config.ts  nodemon.json  package.json
```

---

## PHASE 0 — Project setup

### Task 1: Initialize yarn + TypeScript project

**Files:**
- Create: `package.json`, `tsconfig.json`, `nodemon.json`
- Modify: `.gitignore` (already has node_modules/dist/.env)

- [ ] **Step 1: Init and add dependencies**

Run from `/Users/wichapas/my-anime-catalog`:
```bash
yarn init -y
# Pin zod to v3: all schemas in this plan use the zod 3 string-format API
# (z.string().email(), z.string().date()). Bare `yarn add zod` now resolves to
# zod 4, where those are deprecated/moved and z.string().date() (evaluated at
# module load in list.controller.ts) risks breaking import-time later.
yarn add express pg bcrypt zod@^3.23 cookie-parser helmet cors morgan dotenv axios
yarn add -D typescript ts-node nodemon vitest supertest \
  @types/node @types/express @types/pg @types/bcrypt @types/cookie-parser \
  @types/cors @types/morgan @types/supertest
```
Expected: `package.json`, `yarn.lock`, `node_modules/` created.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "commonjs",
    "moduleResolution": "node",
    "rootDir": ".",
    "outDir": "dist",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "typeRoots": ["./node_modules/@types", "./types"]
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `nodemon.json`**

```json
{ "watch": ["."], "ext": "ts", "ignore": ["dist", "node_modules"], "exec": "ts-node app.ts" }
```

- [ ] **Step 4: Add scripts to `package.json`**

Set the `"scripts"` block to:
```json
{
  "dev": "nodemon",
  "build": "tsc",
  "start": "node dist/app.js",
  "migrate": "ts-node db/migrate.ts",
  "test": "vitest run",
  "test:watch": "vitest"
}
```
Also add `"packageManager": "yarn@1.22.22"` to match chat-api's yarn usage.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: init yarn + typescript project"
```

---

### Task 2: Local Postgres via Docker + env config

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `.env`, `config/constants.config.ts`

- [ ] **Step 1: Create `docker-compose.yml`** (one server, two databases created on init)

```yaml
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: anime
      POSTGRES_PASSWORD: anime
      POSTGRES_DB: anime_catalog
    ports:
      - "5433:5432"
    volumes:
      - anime_pgdata:/var/lib/postgresql/data
      - ./db/init-test-db.sql:/docker-entrypoint-initdb.d/init-test-db.sql
volumes:
  anime_pgdata:
```

- [ ] **Step 2: Create `db/init-test-db.sql`** (creates the separate test DB)

```sql
CREATE DATABASE anime_catalog_test;
```

- [ ] **Step 3: Create `.env.example`** (committed) and `.env` (gitignored, same values for local)

```
PORT=4000
NODE_ENV=development
DATABASE_URL=postgres://anime:anime@localhost:5433/anime_catalog
TEST_DATABASE_URL=postgres://anime:anime@localhost:5433/anime_catalog_test
SESSION_SECRET=dev-only-change-me
SESSION_TTL_DAYS=30
ANILIST_URL=https://graphql.anilist.co
```

- [ ] **Step 4: Create `config/constants.config.ts`**

```ts
import dotenv from "dotenv";
dotenv.config();

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

export const NODE_ENV = process.env.NODE_ENV ?? "development";
export const IS_PROD = NODE_ENV === "production";
export const PORT = Number(process.env.PORT ?? 4000);
export const DATABASE_URL =
  NODE_ENV === "test" ? required("TEST_DATABASE_URL") : required("DATABASE_URL");
export const SESSION_SECRET = required("SESSION_SECRET");
export const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);
export const ANILIST_URL = process.env.ANILIST_URL ?? "https://graphql.anilist.co";

export const SESSION_COOKIE_NAME = "sid";
```

- [ ] **Step 5: Start the DB and commit**

```bash
docker compose up -d
docker compose ps        # expect the db service "running/healthy"
git add -A
git commit -m "chore: add docker postgres and env config"
```
Expected: `docker compose ps` shows the `db` container up; port 5433 listening.

---

### Task 3: DB pool, query helper, and migration runner

**Files:**
- Create: `config/db.config.ts`, `db/migrate.ts`, `db/migrations/0001_init.sql`

- [ ] **Step 1: Create `config/db.config.ts`**

```ts
import { Pool, QueryResultRow } from "pg";
import { DATABASE_URL } from "./constants.config";

export const pool = new Pool({ connectionString: DATABASE_URL });

// Thin typed helper so services never import Pool directly.
export const query = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> => {
  const result = await pool.query<T>(text, params as never[]);
  return result.rows;
};

export const connectDb = async (): Promise<void> => {
  await pool.query("SELECT 1");
  console.log("Postgres connection established.");
};
```

- [ ] **Step 2: Create `db/migrations/0001_init.sql`** (the full schema from the spec)

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      text UNIQUE NOT NULL,
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS anime (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  anilist_id       integer UNIQUE NOT NULL,
  title_romaji     text,
  title_english    text,
  title_native     text,
  cover_image_url  text,
  banner_image_url text,
  synopsis         text,
  episode_count    integer,
  format           text,
  status           text,
  season           text,
  year             integer,
  average_score    integer,
  genres           jsonb,
  cached_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS list_entries (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anime_id    uuid NOT NULL REFERENCES anime(id),
  status      text NOT NULL CHECK (status IN ('watching','completed','on_hold','dropped','plan_to_watch')),
  score       integer CHECK (score BETWEEN 1 AND 10),
  progress    integer NOT NULL DEFAULT 0,
  started_at  date,
  finished_at date,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, anime_id)
);
CREATE INDEX IF NOT EXISTS idx_list_entries_user_id ON list_entries(user_id);
```

- [ ] **Step 3: Create `db/migrate.ts`** (idempotent runner)

```ts
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { pool } from "../config/db.config";

const MIGRATIONS_DIR = join(__dirname, "migrations");

const run = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    (await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(
      (r) => r.name
    )
  );

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied migration ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  console.log("Migrations up to date.");
};

run()
  .then(() => pool.end())
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
```

- [ ] **Step 4: Run the migration against the dev DB**

Run: `yarn migrate`
Expected output: `Applied migration 0001_init.sql` then `Migrations up to date.`
Verify: `docker compose exec db psql -U anime -d anime_catalog -c "\dt"` lists `users, sessions, anime, list_entries, schema_migrations`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add db pool, schema migration 0001, and migration runner"
```

---

### Task 4: Port ApiError, error middleware, Express types, and app skeleton (with healthcheck)

**Files:**
- Create: `types/api-error.ts`, `types/express/index.d.ts`, `middleware/error.middleware.ts`, `pkg/healthcheck/healthcheck.router.ts`, `app.ts`
- Test: `tests/healthcheck.test.ts`, `tests/setup.ts`, `vitest.config.ts`

- [ ] **Step 1: Create `types/api-error.ts`** (ported from chat-api)

```ts
class ApiError {
  code: number;
  message: string;
  constructor(code: number, message: string) {
    this.code = code;
    this.message = message;
  }
  static badRequest(message: string) { return new ApiError(400, message); }
  static unauthorized(message: string) { return new ApiError(401, message); }
  static forbidden(message: string) { return new ApiError(403, message); }
  static notFound(message: string) { return new ApiError(404, message); }
  static conflict(message: string) { return new ApiError(409, message); }
  static internal(message: string, error?: unknown) {
    if (error) console.error("Internal Error:", error);
    return new ApiError(500, message);
  }
}
export default ApiError;
```

- [ ] **Step 2: Create `types/express/index.d.ts`** (augment Request)

```ts
import "express";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; username: string };
    }
  }
}
export {};
```

- [ ] **Step 3: Create `middleware/error.middleware.ts`** (ported from chat-api)

```ts
/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextFunction, Request, Response } from "express";
import ApiError from "../types/api-error";

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof ApiError) {
    return res.status(err.code).json({ code: err.code, error: err.message });
  }
  console.error("Unhandled error:", err);
  return res.status(500).json({ code: 500, error: "Something went wrong" });
};

export const errorRoute = (_req: Request, _res: Response, next: NextFunction) => {
  next(ApiError.notFound("Could not find this route."));
};
```

- [ ] **Step 4: Create `pkg/healthcheck/healthcheck.router.ts`**

```ts
import express from "express";
const router = express.Router();
router.get("/", (_req, res) => res.status(200).json({ status: "ok" }));
export default router;
```

- [ ] **Step 5: Create `app.ts`** — export the app, only `listen` when run directly (so tests can import it)

```ts
import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { PORT, NODE_ENV } from "./config/constants.config";
import { connectDb } from "./config/db.config";
import { errorHandler, errorRoute } from "./middleware/error.middleware";
import healthCheckRouter from "./pkg/healthcheck/healthcheck.router";

export const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
if (NODE_ENV !== "test") app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use("/healthz", healthCheckRouter);
// feature routers mounted here in later tasks

app.use(errorRoute);
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, async () => {
    await connectDb();
    console.log(`Server running on port ${PORT}`);
  });
}
```

- [ ] **Step 6: Create `vitest.config.ts` and `tests/setup.ts`**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globalSetup: ["./tests/setup.ts"],
    env: { NODE_ENV: "test" },
    fileParallelism: false, // single shared test DB
  },
});
```

`tests/setup.ts` (runs migrations on the test DB once before the suite):
```ts
import { execSync } from "child_process";
export default function () {
  execSync("ts-node db/migrate.ts", {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "test" },
  });
}
```

- [ ] **Step 7: Write the failing healthcheck test** — `tests/healthcheck.test.ts`

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../app";

describe("GET /healthz", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 8: Run tests**

Run: `yarn test`
Expected: healthcheck test PASSES (migrations run against the test DB in global setup first).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add ApiError, error middleware, app skeleton, healthcheck + test harness"
```

---

### Task 5: Create the private GitHub repo and push

**Files:** none (git/gh operations)

- [ ] **Step 1: Switch gh to the personal account**

```bash
gh auth switch --user Muffing21
gh auth status   # confirm Muffing21 is the active account
```
Expected: `Active account: true` under `Muffing21`.

- [ ] **Step 2: Create the private repo and push**

```bash
gh repo create my-anime-catalog --private --source=. --remote=origin --push
```
Expected: repo created under `github.com/Muffing21/my-anime-catalog`, `main` pushed.

- [ ] **Step 3: Verify identity on pushed commits**

```bash
git log -1 --format='%an <%ae>'
```
Expected: `Muffing21 <96890792+Muffing21@users.noreply.github.com>` (personal, not work). If the remote push used the wrong gh account, `gh auth switch` and re-push.

---

## PHASE 1 — Auth (cookie sessions)

### Task 6: Password helper (bcrypt)

**Files:**
- Create: `utils/password.helper.ts`
- Test: `tests/password.helper.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../utils/password.helper";

describe("password helper", () => {
  it("hashes then verifies the same password", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toBe("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run tests/password.helper.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `utils/password.helper.ts`**

```ts
import bcrypt from "bcrypt";
const ROUNDS = 12;
export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);
```

- [ ] **Step 4: Run to verify it passes** — Run: `yarn vitest run tests/password.helper.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add utils/password.helper.ts tests/password.helper.test.ts
git commit -m "feat: add bcrypt password helper"
```

---

### Task 7: Session helper (create / find / destroy session rows)

**Files:**
- Create: `utils/session.helper.ts`
- Test: `tests/session.helper.test.ts`, `tests/helpers/db.ts`

- [ ] **Step 1: Create `tests/helpers/db.ts`** (truncate helper reused by later tests)

```ts
import { query } from "../../config/db.config";
export const resetDb = async (): Promise<void> => {
  await query("TRUNCATE list_entries, sessions, anime, users RESTART IDENTITY CASCADE");
};
```

- [ ] **Step 2: Write the failing test** — `tests/session.helper.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { query } from "../config/db.config";
import { resetDb } from "./helpers/db";
import { createSession, findValidSession, destroySession } from "../utils/session.helper";

const makeUser = async () => {
  const rows = await query<{ id: string }>(
    "INSERT INTO users(username,email,password_hash) VALUES ($1,$2,$3) RETURNING id",
    ["u1", "u1@example.com", "x"]
  );
  return rows[0].id;
};

describe("session helper", () => {
  beforeEach(resetDb);

  it("creates a session and finds it as valid", async () => {
    const userId = await makeUser();
    const session = await createSession(userId);
    const found = await findValidSession(session.id);
    expect(found?.user_id).toBe(userId);
  });

  it("does not return an expired session", async () => {
    const userId = await makeUser();
    const session = await createSession(userId);
    await query("UPDATE sessions SET expires_at = now() - interval '1 day' WHERE id = $1", [session.id]);
    expect(await findValidSession(session.id)).toBeNull();
  });

  it("destroys a session", async () => {
    const userId = await makeUser();
    const session = await createSession(userId);
    await destroySession(session.id);
    expect(await findValidSession(session.id)).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails** → Expected FAIL (module not found).

- [ ] **Step 4: Implement `utils/session.helper.ts`**

```ts
import { CookieOptions } from "express";
import { query } from "../config/db.config";
import { SESSION_TTL_DAYS, IS_PROD } from "../config/constants.config";

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
}

export const createSession = async (userId: string): Promise<SessionRow> => {
  const rows = await query<SessionRow>(
    `INSERT INTO sessions(user_id, expires_at)
     VALUES ($1, now() + ($2 || ' days')::interval)
     RETURNING *`,
    [userId, SESSION_TTL_DAYS]
  );
  return rows[0];
};

export const findValidSession = async (sessionId: string): Promise<SessionRow | null> => {
  const rows = await query<SessionRow>(
    "SELECT * FROM sessions WHERE id = $1 AND expires_at > now()",
    [sessionId]
  );
  return rows[0] ?? null;
};

export const destroySession = async (sessionId: string): Promise<void> => {
  await query("DELETE FROM sessions WHERE id = $1", [sessionId]);
};

export const sessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: "lax",
  secure: IS_PROD,
  maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  path: "/",
});
```

- [ ] **Step 5: Run to verify it passes** → PASS

- [ ] **Step 6: Commit**

```bash
git add utils/session.helper.ts tests/session.helper.test.ts tests/helpers/db.ts
git commit -m "feat: add session helper with DB-backed session rows"
```

---

### Task 8: Auth service (register + login logic)

**Files:**
- Create: `pkg/auth/auth.service.ts`
- Test: `tests/auth.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/db";
import { authService } from "../pkg/auth/auth.service";
import ApiError from "../types/api-error";

describe("authService", () => {
  beforeEach(resetDb);

  it("registers a user and stores a non-plaintext password", async () => {
    const user = await authService.register("neo", "neo@example.com", "hunter2");
    expect(user.username).toBe("neo");
    expect((user as any).password_hash).toBeUndefined(); // never leak the hash
  });

  it("rejects a duplicate username", async () => {
    await authService.register("neo", "neo@example.com", "hunter2");
    await expect(
      authService.register("neo", "other@example.com", "hunter2")
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    await authService.register("neo", "neo@example.com", "hunter2");
    const ok = await authService.login("neo", "hunter2");
    expect(ok.username).toBe("neo");
    await expect(authService.login("neo", "wrong")).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (module not found).

- [ ] **Step 3: Implement `pkg/auth/auth.service.ts`**

```ts
import { query } from "../../config/db.config";
import ApiError from "../../types/api-error";
import { hashPassword, verifyPassword } from "../../utils/password.helper";

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  created_at: Date;
}

interface UserRow extends PublicUser {
  password_hash: string;
}

const toPublic = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  email: u.email,
  created_at: u.created_at,
});

const register = async (
  username: string,
  email: string,
  password: string
): Promise<PublicUser> => {
  const existing = await query<UserRow>(
    "SELECT id FROM users WHERE username = $1 OR email = $2",
    [username, email]
  );
  if (existing.length > 0) throw ApiError.conflict("Username or email already in use");

  const passwordHash = await hashPassword(password);
  const rows = await query<UserRow>(
    `INSERT INTO users(username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, email, created_at`,
    [username, email, passwordHash]
  );
  return toPublic(rows[0]);
};

const login = async (username: string, password: string): Promise<PublicUser> => {
  const rows = await query<UserRow>("SELECT * FROM users WHERE username = $1", [username]);
  const user = rows[0];
  if (!user) throw ApiError.unauthorized("Invalid username or password");
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw ApiError.unauthorized("Invalid username or password");
  return toPublic(user);
};

const getById = async (id: string): Promise<PublicUser | null> => {
  const rows = await query<UserRow>(
    "SELECT id, username, email, created_at FROM users WHERE id = $1",
    [id]
  );
  return rows[0] ? toPublic(rows[0]) : null;
};

export const authService = { register, login, getById };
```

- [ ] **Step 4: Run to verify it passes** → PASS

- [ ] **Step 5: Commit**

```bash
git add pkg/auth/auth.service.ts tests/auth.service.test.ts
git commit -m "feat: add auth service (register/login) with hashed passwords"
```

---

### Task 9: Auth controller, router, auth middleware, and wiring (integration)

**Files:**
- Create: `pkg/auth/auth.controller.ts`, `pkg/auth/auth.router.ts`, `middleware/auth.middleware.ts`
- Modify: `app.ts` (mount auth router)
- Test: `tests/auth.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { resetDb } from "./helpers/db";

describe("auth flow", () => {
  beforeEach(resetDb);

  it("register -> login sets cookie -> me works -> logout invalidates", async () => {
    const agent = request.agent(app);

    const reg = await agent
      .post("/api/v1/auth/register")
      .send({ username: "neo", email: "neo@example.com", password: "hunter2" });
    expect(reg.status).toBe(201);

    const login = await agent
      .post("/api/v1/auth/login")
      .send({ username: "neo", password: "hunter2" });
    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"]?.[0]).toContain("sid=");
    expect(login.headers["set-cookie"]?.[0]).toContain("HttpOnly");

    const me = await agent.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.username).toBe("neo");

    await agent.post("/api/v1/auth/logout").expect(200);

    const meAfter = await agent.get("/api/v1/auth/me");
    expect(meAfter.status).toBe(401);
  });

  it("rejects register with invalid body", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "x" }); // missing email/password, too short
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (routes 404 / not wired).

- [ ] **Step 3: Implement `middleware/auth.middleware.ts`**

```ts
import { NextFunction, Request, Response } from "express";
import ApiError from "../types/api-error";
import { SESSION_COOKIE_NAME } from "../config/constants.config";
import { findValidSession } from "../utils/session.helper";
import { authService } from "../pkg/auth/auth.service";

// try/catch so a rejected DB promise reaches errorHandler regardless of the
// installed Express major (Express 4 does not auto-forward async rejections).
export const authHandler = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    if (!sessionId) return next(ApiError.unauthorized("Not authenticated"));

    const session = await findValidSession(sessionId);
    if (!session) return next(ApiError.unauthorized("Session expired or invalid"));

    const user = await authService.getById(session.user_id);
    if (!user) return next(ApiError.unauthorized("Account not found"));

    req.user = { id: user.id, username: user.username };
    return next();
  } catch (e) {
    return next(ApiError.internal("Authentication failed", e));
  }
};
```

- [ ] **Step 4: Implement `pkg/auth/auth.controller.ts`** (zod validation lives here)

```ts
import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import ApiError from "../../types/api-error";
import { authService } from "./auth.service";
import { createSession, destroySession, sessionCookieOptions } from "../../utils/session.helper";
import { SESSION_COOKIE_NAME } from "../../config/constants.config";

const registerSchema = z.object({
  username: z.string().min(3).max(30),
  email: z.string().email(),
  password: z.string().min(6).max(100),
});
const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const register = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return next(ApiError.badRequest(parsed.error.issues[0].message));
  try {
    const { username, email, password } = parsed.data;
    const user = await authService.register(username, email, password);
    return res.status(201).json(user);
  } catch (e) {
    if (e instanceof ApiError) return next(e);
    return next(ApiError.internal("Could not register", e));
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return next(ApiError.badRequest(parsed.error.issues[0].message));
  try {
    const { username, password } = parsed.data;
    const user = await authService.login(username, password);
    const session = await createSession(user.id);
    res.cookie(SESSION_COOKIE_NAME, session.id, sessionCookieOptions());
    return res.status(200).json(user);
  } catch (e) {
    if (e instanceof ApiError) return next(e);
    return next(ApiError.internal("Could not log in", e));
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    if (sessionId) await destroySession(sessionId);
    res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
    return res.status(200).json({ success: true });
  } catch (e) {
    return next(ApiError.internal("Could not log out", e));
  }
};

export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await authService.getById(req.user!.id);
    if (!user) return next(ApiError.notFound("User not found"));
    return res.status(200).json(user);
  } catch (e) {
    return next(ApiError.internal("Could not load user", e));
  }
};
```

- [ ] **Step 5: Implement `pkg/auth/auth.router.ts`** (per-route middleware visible here)

```ts
import express from "express";
import { register, login, logout, me } from "./auth.controller";
import { authHandler } from "../../middleware/auth.middleware";

const router = express.Router();
router.post("/register", register);
router.post("/login", login);
router.post("/logout", authHandler, logout);
router.get("/me", authHandler, me);
export default router;
```

- [ ] **Step 6: Mount in `app.ts`**

Add import `import authRouter from "./pkg/auth/auth.router";` and, where the comment `// feature routers mounted here` is:
```ts
app.use("/api/v1/auth", authRouter);
```

- [ ] **Step 7: Run tests** — Run: `yarn test` → all auth tests PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add cookie-session auth (controller, router, middleware) with integration tests"
```

---

## PHASE 2 — Anime + read-through cache

### Task 10: AniList client (`services/anilist.service.ts`)

**Files:**
- Create: `services/anilist.service.ts`
- Test: `tests/anilist.service.test.ts` (axios mocked — no live network)

- [ ] **Step 1: Write the failing test** (mock `axios`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { anilistService } from "../services/anilist.service";

vi.mock("axios");
const mockedPost = vi.mocked(axios.post);

const mediaPayload = (over: Record<string, unknown> = {}) => ({
  id: 21,
  title: { romaji: "One Piece", english: "One Piece", native: "ワンピース" },
  coverImage: { large: "cover.jpg" },
  bannerImage: "banner.jpg",
  description: "Pirates.",
  episodes: 1000,
  format: "TV",
  status: "RELEASING",
  season: "FALL",
  seasonYear: 1999,
  averageScore: 88,
  genres: ["Action", "Adventure"],
  ...over,
});

describe("anilistService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes a fetched anime by anilist id", async () => {
    mockedPost.mockResolvedValueOnce({ data: { data: { Media: mediaPayload() } } } as any);
    const anime = await anilistService.fetchById(21);
    expect(anime).toMatchObject({
      anilist_id: 21,
      title_romaji: "One Piece",
      cover_image_url: "cover.jpg",
      episode_count: 1000,
      year: 1999,
      average_score: 88,
      genres: ["Action", "Adventure"],
    });
  });

  it("returns null when AniList has no such media", async () => {
    mockedPost.mockResolvedValueOnce({ data: { data: { Media: null } } } as any);
    expect(await anilistService.fetchById(999999999)).toBeNull();
  });

  it("maps search results to normalized shape", async () => {
    mockedPost.mockResolvedValueOnce({
      data: { data: { Page: { media: [mediaPayload(), mediaPayload({ id: 1 })] } } },
    } as any);
    const results = await anilistService.search("one piece");
    expect(results).toHaveLength(2);
    expect(results[0].anilist_id).toBe(21);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (module not found).

- [ ] **Step 3: Implement `services/anilist.service.ts`**

```ts
import axios from "axios";
import { ANILIST_URL } from "../config/constants.config";
import ApiError from "../types/api-error";

export interface NormalizedAnime {
  anilist_id: number;
  title_romaji: string | null;
  title_english: string | null;
  title_native: string | null;
  cover_image_url: string | null;
  banner_image_url: string | null;
  synopsis: string | null;
  episode_count: number | null;
  format: string | null;
  status: string | null;
  season: string | null;
  year: number | null;
  average_score: number | null;
  genres: string[];
}

interface AniListMedia {
  id: number;
  title?: { romaji?: string; english?: string; native?: string };
  coverImage?: { large?: string };
  bannerImage?: string;
  description?: string;
  episodes?: number;
  format?: string;
  status?: string;
  season?: string;
  seasonYear?: number;
  averageScore?: number;
  genres?: string[];
}

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  coverImage { large }
  bannerImage
  description(asHtml: false)
  episodes format status season seasonYear averageScore genres
`;

const normalize = (m: AniListMedia): NormalizedAnime => ({
  anilist_id: m.id,
  title_romaji: m.title?.romaji ?? null,
  title_english: m.title?.english ?? null,
  title_native: m.title?.native ?? null,
  cover_image_url: m.coverImage?.large ?? null,
  banner_image_url: m.bannerImage ?? null,
  synopsis: m.description ?? null,
  episode_count: m.episodes ?? null,
  format: m.format ?? null,
  status: m.status ?? null,
  season: m.season ?? null,
  year: m.seasonYear ?? null,
  average_score: m.averageScore ?? null,
  genres: m.genres ?? [],
});

const gql = async <T>(queryStr: string, variables: Record<string, unknown>): Promise<T> => {
  try {
    const res = await axios.post(
      ANILIST_URL,
      { query: queryStr, variables },
      { headers: { "Content-Type": "application/json" }, timeout: 8000 }
    );
    return res.data.data as T;
  } catch (e) {
    throw ApiError.internal("AniList request failed", e);
  }
};

const fetchById = async (anilistId: number): Promise<NormalizedAnime | null> => {
  const data = await gql<{ Media: AniListMedia | null }>(
    `query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`,
    { id: anilistId }
  );
  return data.Media ? normalize(data.Media) : null;
};

const search = async (term: string): Promise<NormalizedAnime[]> => {
  const data = await gql<{ Page: { media: AniListMedia[] } }>(
    `query ($q: String) {
       Page(perPage: 20) { media(search: $q, type: ANIME, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} } }
     }`,
    { q: term }
  );
  return (data.Page?.media ?? []).map(normalize);
};

export const anilistService = { fetchById, search };
```

- [ ] **Step 4: Run to verify it passes** → PASS

- [ ] **Step 5: Commit**

```bash
git add services/anilist.service.ts tests/anilist.service.test.ts
git commit -m "feat: add AniList client with normalized search + fetchById"
```

---

### Task 11: Anime service (read-through cache)

**Files:**
- Create: `pkg/anime/anime.service.ts`
- Test: `tests/anime.service.test.ts` (mock `anilistService`)

- [ ] **Step 1: Write the failing test** — assert cache MISS fetches once + inserts, HIT fetches zero

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "./helpers/db";
import { query } from "../config/db.config";
import { animeService } from "../pkg/anime/anime.service";
import { anilistService } from "../services/anilist.service";

vi.mock("../services/anilist.service", () => ({
  anilistService: { fetchById: vi.fn(), search: vi.fn() },
}));
const fetchById = vi.mocked(anilistService.fetchById);

const normalized = (id = 21) => ({
  anilist_id: id, title_romaji: "One Piece", title_english: "One Piece",
  title_native: "ワンピース", cover_image_url: "c.jpg", banner_image_url: "b.jpg",
  synopsis: "Pirates.", episode_count: 1000, format: "TV", status: "RELEASING",
  season: "FALL", year: 1999, average_score: 88, genres: ["Action"],
});

describe("animeService read-through cache", () => {
  beforeEach(async () => { await resetDb(); vi.clearAllMocks(); });

  it("MISS: fetches from AniList once and inserts locally", async () => {
    fetchById.mockResolvedValueOnce(normalized());
    const anime = await animeService.getOrFetchByAnilistId(21);
    expect(fetchById).toHaveBeenCalledTimes(1);
    expect(anime.anilist_id).toBe(21);
    const rows = await query("SELECT * FROM anime WHERE anilist_id = 21");
    expect(rows).toHaveLength(1);
  });

  it("HIT: second call serves from DB without calling AniList", async () => {
    fetchById.mockResolvedValueOnce(normalized());
    await animeService.getOrFetchByAnilistId(21); // populate
    fetchById.mockClear();
    const anime = await animeService.getOrFetchByAnilistId(21);
    expect(fetchById).not.toHaveBeenCalled();
    expect(anime.anilist_id).toBe(21);
  });

  it("throws notFound when AniList has no such anime", async () => {
    fetchById.mockResolvedValueOnce(null);
    await expect(animeService.getOrFetchByAnilistId(999)).rejects.toMatchObject({ code: 404 });
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (module not found).

- [ ] **Step 3: Implement `pkg/anime/anime.service.ts`**

```ts
import { query } from "../../config/db.config";
import ApiError from "../../types/api-error";
import { anilistService, NormalizedAnime } from "../../services/anilist.service";

export interface AnimeRow extends NormalizedAnime {
  id: string;
  cached_at: Date;
}

const findByAnilistId = async (anilistId: number): Promise<AnimeRow | null> => {
  const rows = await query<AnimeRow>("SELECT * FROM anime WHERE anilist_id = $1", [anilistId]);
  return rows[0] ?? null;
};

const insertAnime = async (a: NormalizedAnime): Promise<AnimeRow> => {
  const rows = await query<AnimeRow>(
    `INSERT INTO anime
       (anilist_id, title_romaji, title_english, title_native, cover_image_url,
        banner_image_url, synopsis, episode_count, format, status, season, year,
        average_score, genres)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (anilist_id) DO UPDATE SET anilist_id = EXCLUDED.anilist_id
     RETURNING *`,
    [
      a.anilist_id, a.title_romaji, a.title_english, a.title_native, a.cover_image_url,
      a.banner_image_url, a.synopsis, a.episode_count, a.format, a.status, a.season,
      a.year, a.average_score, JSON.stringify(a.genres),
    ]
  );
  return rows[0];
};

// Read-through cache: DB first, AniList on miss, then persist.
const getOrFetchByAnilistId = async (anilistId: number): Promise<AnimeRow> => {
  const cached = await findByAnilistId(anilistId);
  if (cached) return cached;

  const fetched = await anilistService.fetchById(anilistId);
  if (!fetched) throw ApiError.notFound("Anime not found on AniList");
  return insertAnime(fetched);
};

// Search always hits AniList (broad, not per-id cacheable).
const search = (term: string) => anilistService.search(term);

export const animeService = { getOrFetchByAnilistId, findByAnilistId, insertAnime, search };
```

- [ ] **Step 4: Run to verify it passes** → PASS

- [ ] **Step 5: Commit**

```bash
git add pkg/anime/anime.service.ts tests/anime.service.test.ts
git commit -m "feat: add anime read-through cache service"
```

---

### Task 12: Anime controller, router, wiring

**Files:**
- Create: `pkg/anime/anime.controller.ts`, `pkg/anime/anime.router.ts`
- Modify: `app.ts`
- Test: `tests/anime.integration.test.ts` (mock `anilistService`)

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { app } from "../app";
import { resetDb } from "./helpers/db";
import { anilistService } from "../services/anilist.service";

vi.mock("../services/anilist.service", () => ({
  anilistService: { fetchById: vi.fn(), search: vi.fn() },
}));
const fetchById = vi.mocked(anilistService.fetchById);
const search = vi.mocked(anilistService.search);
const normalized = (id = 21) => ({
  anilist_id: id, title_romaji: "One Piece", title_english: "One Piece",
  title_native: "x", cover_image_url: null, banner_image_url: null, synopsis: null,
  episode_count: 1000, format: "TV", status: "RELEASING", season: null, year: 1999,
  average_score: 88, genres: ["Action"],
});

describe("anime routes", () => {
  beforeEach(async () => { await resetDb(); vi.clearAllMocks(); });

  it("GET /anime/search returns normalized results", async () => {
    search.mockResolvedValueOnce([normalized()]);
    const res = await request(app).get("/api/v1/anime/search?q=one");
    expect(res.status).toBe(200);
    expect(res.body[0].anilist_id).toBe(21);
  });

  it("GET /anime/:anilistId caches on miss then serves locally", async () => {
    fetchById.mockResolvedValueOnce(normalized());
    const first = await request(app).get("/api/v1/anime/21");
    expect(first.status).toBe(200);
    expect(fetchById).toHaveBeenCalledTimes(1);

    const second = await request(app).get("/api/v1/anime/21");
    expect(second.status).toBe(200);
    expect(fetchById).toHaveBeenCalledTimes(1); // still 1 -> served from cache
  });

  it("GET /anime/search requires q", async () => {
    const res = await request(app).get("/api/v1/anime/search");
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (routes not wired).

- [ ] **Step 3: Implement `pkg/anime/anime.controller.ts`**

```ts
import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import ApiError from "../../types/api-error";
import { animeService } from "./anime.service";

const searchSchema = z.object({ q: z.string().min(1, "q is required") });
const idSchema = z.object({ anilistId: z.coerce.number().int().positive() });

export const search = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) return next(ApiError.badRequest(parsed.error.issues[0].message));
  try {
    return res.status(200).json(await animeService.search(parsed.data.q));
  } catch (e) {
    if (e instanceof ApiError) return next(e);
    return next(ApiError.internal("Search failed", e));
  }
};

export const getByAnilistId = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) return next(ApiError.badRequest("Invalid anilist id"));
  try {
    return res.status(200).json(await animeService.getOrFetchByAnilistId(parsed.data.anilistId));
  } catch (e) {
    if (e instanceof ApiError) return next(e);
    return next(ApiError.internal("Could not load anime", e));
  }
};
```

- [ ] **Step 4: Implement `pkg/anime/anime.router.ts`** (order matters: `/search` before `/:anilistId`)

```ts
import express from "express";
import { search, getByAnilistId } from "./anime.controller";

const router = express.Router();
router.get("/search", search);
router.get("/:anilistId", getByAnilistId);
export default router;
```

- [ ] **Step 5: Mount in `app.ts`** — add `import animeRouter from "./pkg/anime/anime.router";` and `app.use("/api/v1/anime", animeRouter);`

- [ ] **Step 6: Run tests** → PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add anime search + detail routes (read-through cache)"
```

---

## PHASE 3 — Personal list CRUD

### Task 13: List service (add / list / update / remove, ownership-scoped)

**Files:**
- Create: `pkg/list/list.service.ts`
- Test: `tests/list.service.test.ts` (mock `anilistService` so add-by-anilistId can cache)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "./helpers/db";
import { query } from "../config/db.config";
import { listService } from "../pkg/list/list.service";
import { anilistService } from "../services/anilist.service";

vi.mock("../services/anilist.service", () => ({
  anilistService: { fetchById: vi.fn(), search: vi.fn() },
}));
const fetchById = vi.mocked(anilistService.fetchById);
const normalized = (id = 21) => ({
  anilist_id: id, title_romaji: "One Piece", title_english: "One Piece",
  title_native: "x", cover_image_url: null, banner_image_url: null, synopsis: null,
  episode_count: 1000, format: "TV", status: "RELEASING", season: null, year: 1999,
  average_score: 88, genres: ["Action"],
});

const makeUser = async (username: string) => {
  const rows = await query<{ id: string }>(
    "INSERT INTO users(username,email,password_hash) VALUES ($1,$2,$3) RETURNING id",
    [username, `${username}@x.com`, "x"]
  );
  return rows[0].id;
};

describe("listService", () => {
  beforeEach(async () => { await resetDb(); vi.clearAllMocks(); });

  it("adds an anime (caching it) and lists it back", async () => {
    const userId = await makeUser("neo");
    fetchById.mockResolvedValueOnce(normalized());
    const entry = await listService.add(userId, { anilistId: 21, status: "watching" });
    expect(entry.status).toBe("watching");

    const list = await listService.list(userId, {});
    expect(list).toHaveLength(1);
    expect(list[0].anime.anilist_id).toBe(21);
  });

  it("rejects a duplicate entry for the same user+anime", async () => {
    const userId = await makeUser("neo");
    fetchById.mockResolvedValue(normalized());
    await listService.add(userId, { anilistId: 21, status: "watching" });
    await expect(
      listService.add(userId, { anilistId: 21, status: "completed" })
    ).rejects.toMatchObject({ code: 409 });
  });

  it("updates only the owner's entry, refusing others", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");
    fetchById.mockResolvedValueOnce(normalized());
    const entry = await listService.add(owner, { anilistId: 21, status: "watching" });

    const updated = await listService.update(owner, entry.anime_id, { score: 9, progress: 5 });
    expect(updated.score).toBe(9);

    await expect(
      listService.update(other, entry.anime_id, { score: 1 })
    ).rejects.toMatchObject({ code: 404 });
  });

  it("removes only the owner's entry", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");
    fetchById.mockResolvedValueOnce(normalized());
    const entry = await listService.add(owner, { anilistId: 21, status: "watching" });

    await expect(listService.remove(other, entry.anime_id)).rejects.toMatchObject({ code: 404 });
    await listService.remove(owner, entry.anime_id);
    expect(await listService.list(owner, {})).toHaveLength(0);
  });

  it("filters by status", async () => {
    const userId = await makeUser("neo");
    fetchById.mockResolvedValueOnce(normalized(1));
    fetchById.mockResolvedValueOnce(normalized(2));
    await listService.add(userId, { anilistId: 1, status: "watching" });
    await listService.add(userId, { anilistId: 2, status: "completed" });
    const watching = await listService.list(userId, { status: "watching" });
    expect(watching).toHaveLength(1);
    expect(watching[0].anime.anilist_id).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (module not found).

- [ ] **Step 3: Implement `pkg/list/list.service.ts`**

```ts
import { query } from "../../config/db.config";
import ApiError from "../../types/api-error";
import { animeService } from "../anime/anime.service";
import { AnimeRow } from "../anime/anime.service";

export type ListStatus =
  | "watching" | "completed" | "on_hold" | "dropped" | "plan_to_watch";

export interface ListEntryRow {
  id: string;
  user_id: string;
  anime_id: string;
  status: ListStatus;
  score: number | null;
  progress: number;
  started_at: string | null;
  finished_at: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AddInput {
  anilistId: number;
  status: ListStatus;
  score?: number | null;
  progress?: number;
  notes?: string | null;
}

export interface UpdateInput {
  status?: ListStatus;
  score?: number | null;
  progress?: number;
  notes?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface ListFilter {
  status?: ListStatus;
  sort?: "score" | "updated_at" | "created_at";
}

const add = async (userId: string, input: AddInput): Promise<ListEntryRow> => {
  const anime = await animeService.getOrFetchByAnilistId(input.anilistId); // caches on miss
  const dup = await query<ListEntryRow>(
    "SELECT id FROM list_entries WHERE user_id = $1 AND anime_id = $2",
    [userId, anime.id]
  );
  if (dup.length > 0) throw ApiError.conflict("Anime already in your list");

  const rows = await query<ListEntryRow>(
    `INSERT INTO list_entries (user_id, anime_id, status, score, progress, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [userId, anime.id, input.status, input.score ?? null, input.progress ?? 0, input.notes ?? null]
  );
  return rows[0];
};

const list = async (
  userId: string,
  filter: ListFilter
): Promise<Array<ListEntryRow & { anime: AnimeRow }>> => {
  const sortColumn =
    filter.sort === "score" ? "le.score" :
    filter.sort === "created_at" ? "le.created_at" : "le.updated_at";

  const params: unknown[] = [userId];
  let where = "le.user_id = $1";
  if (filter.status) {
    params.push(filter.status);
    where += ` AND le.status = $${params.length}`;
  }

  const rows = await query<ListEntryRow & { anime: AnimeRow }>(
    `SELECT le.*, row_to_json(a.*) AS anime
     FROM list_entries le
     JOIN anime a ON a.id = le.anime_id
     WHERE ${where}
     ORDER BY ${sortColumn} DESC NULLS LAST`,
    params
  );
  return rows;
};

const update = async (
  userId: string,
  animeId: string,
  input: UpdateInput
): Promise<ListEntryRow> => {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  if (input.status !== undefined) push("status", input.status);
  if (input.score !== undefined) push("score", input.score);
  if (input.progress !== undefined) push("progress", input.progress);
  if (input.notes !== undefined) push("notes", input.notes);
  if (input.started_at !== undefined) push("started_at", input.started_at);
  if (input.finished_at !== undefined) push("finished_at", input.finished_at);
  if (sets.length === 0) throw ApiError.badRequest("No fields to update");

  sets.push("updated_at = now()"); // raw SQL: bump updated_at explicitly (spec decision)

  params.push(userId);
  const userIdx = params.length;
  params.push(animeId);
  const animeIdx = params.length;

  const rows = await query<ListEntryRow>(
    `UPDATE list_entries SET ${sets.join(", ")}
     WHERE user_id = $${userIdx} AND anime_id = $${animeIdx}
     RETURNING *`,
    params
  );
  if (rows.length === 0) throw ApiError.notFound("List entry not found");
  return rows[0];
};

const remove = async (userId: string, animeId: string): Promise<void> => {
  const rows = await query<{ id: string }>(
    "DELETE FROM list_entries WHERE user_id = $1 AND anime_id = $2 RETURNING id",
    [userId, animeId]
  );
  if (rows.length === 0) throw ApiError.notFound("List entry not found");
};

export const listService = { add, list, update, remove };
```

Note the ownership pattern: every `update`/`remove` scopes on `user_id = $userId`, so another user's `WHERE` never matches and returns 0 rows → `notFound`. That is the security property under test.

- [ ] **Step 4: Run to verify it passes** → PASS

- [ ] **Step 5: Commit**

```bash
git add pkg/list/list.service.ts tests/list.service.test.ts
git commit -m "feat: add list service with ownership-scoped CRUD"
```

---

### Task 14: List controller, router, wiring (integration)

**Files:**
- Create: `pkg/list/list.controller.ts`, `pkg/list/list.router.ts`
- Modify: `app.ts`
- Test: `tests/list.integration.test.ts` (mock `anilistService`; real auth via cookie agent)

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { app } from "../app";
import { resetDb } from "./helpers/db";
import { anilistService } from "../services/anilist.service";

vi.mock("../services/anilist.service", () => ({
  anilistService: { fetchById: vi.fn(), search: vi.fn() },
}));
const fetchById = vi.mocked(anilistService.fetchById);
const normalized = (id = 21) => ({
  anilist_id: id, title_romaji: "One Piece", title_english: "One Piece",
  title_native: "x", cover_image_url: null, banner_image_url: null, synopsis: null,
  episode_count: 1000, format: "TV", status: "RELEASING", season: null, year: 1999,
  average_score: 88, genres: ["Action"],
});

const registerAndLogin = async (username: string) => {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/register").send({ username, email: `${username}@x.com`, password: "hunter2" });
  await agent.post("/api/v1/auth/login").send({ username, password: "hunter2" });
  return agent;
};

describe("list routes", () => {
  beforeEach(async () => { await resetDb(); vi.clearAllMocks(); });

  it("requires auth", async () => {
    const res = await request(app).get("/api/v1/list");
    expect(res.status).toBe(401);
  });

  it("add -> list -> update -> delete happy path", async () => {
    const agent = await registerAndLogin("neo");
    fetchById.mockResolvedValueOnce(normalized());

    const add = await agent.post("/api/v1/list").send({ anilistId: 21, status: "watching" });
    expect(add.status).toBe(201);
    const animeId = add.body.anime_id;

    const list = await agent.get("/api/v1/list");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const upd = await agent.patch(`/api/v1/list/${animeId}`).send({ score: 9, progress: 12 });
    expect(upd.status).toBe(200);
    expect(upd.body.score).toBe(9);

    const del = await agent.delete(`/api/v1/list/${animeId}`);
    expect(del.status).toBe(200);
  });

  it("one user cannot modify another user's entry", async () => {
    const owner = await registerAndLogin("owner");
    const other = await registerAndLogin("other");
    fetchById.mockResolvedValueOnce(normalized());
    const add = await owner.post("/api/v1/list").send({ anilistId: 21, status: "watching" });
    const animeId = add.body.anime_id;

    const res = await other.patch(`/api/v1/list/${animeId}`).send({ score: 1 });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (routes not wired).

- [ ] **Step 3: Implement `pkg/list/list.controller.ts`**

```ts
import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import ApiError from "../../types/api-error";
import { listService } from "./list.service";

const statusEnum = z.enum(["watching", "completed", "on_hold", "dropped", "plan_to_watch"]);

const addSchema = z.object({
  anilistId: z.number().int().positive(),
  status: statusEnum,
  score: z.number().int().min(1).max(10).nullish(),
  progress: z.number().int().min(0).optional(),
  notes: z.string().max(2000).nullish(),
});

const updateSchema = z.object({
  status: statusEnum.optional(),
  score: z.number().int().min(1).max(10).nullish(),
  progress: z.number().int().min(0).optional(),
  notes: z.string().max(2000).nullish(),
  started_at: z.string().date().nullish(),
  finished_at: z.string().date().nullish(),
}).refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

const listQuerySchema = z.object({
  status: statusEnum.optional(),
  sort: z.enum(["score", "updated_at", "created_at"]).optional(),
});

export const add = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return next(ApiError.badRequest(parsed.error.issues[0].message));
  try {
    const entry = await listService.add(req.user!.id, parsed.data);
    return res.status(201).json(entry);
  } catch (e) {
    if (e instanceof ApiError) return next(e);
    return next(ApiError.internal("Could not add to list", e));
  }
};

export const list = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return next(ApiError.badRequest(parsed.error.issues[0].message));
  try {
    return res.status(200).json(await listService.list(req.user!.id, parsed.data));
  } catch (e) {
    if (e instanceof ApiError) return next(e);
    return next(ApiError.internal("Could not load list", e));
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return next(ApiError.badRequest(parsed.error.issues[0].message));
  try {
    const entry = await listService.update(req.user!.id, req.params.animeId, parsed.data);
    return res.status(200).json(entry);
  } catch (e) {
    if (e instanceof ApiError) return next(e);
    return next(ApiError.internal("Could not update entry", e));
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await listService.remove(req.user!.id, req.params.animeId);
    return res.status(200).json({ success: true });
  } catch (e) {
    if (e instanceof ApiError) return next(e);
    return next(ApiError.internal("Could not remove entry", e));
  }
};
```

- [ ] **Step 4: Implement `pkg/list/list.router.ts`** (auth on every route)

```ts
import express from "express";
import { add, list, update, remove } from "./list.controller";
import { authHandler } from "../../middleware/auth.middleware";

const router = express.Router();
router.get("/", authHandler, list);
router.post("/", authHandler, add);
router.patch("/:animeId", authHandler, update);
router.delete("/:animeId", authHandler, remove);
export default router;
```

- [ ] **Step 5: Mount in `app.ts`** — add `import listRouter from "./pkg/list/list.router";` and `app.use("/api/v1/list", listRouter);`

- [ ] **Step 6: Run the full suite** — Run: `yarn test` → ALL tests PASS.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "feat: add personal list CRUD routes with ownership enforcement"
git push
```

---

## Final verification

- [ ] **Step 1: Full test suite green** — Run: `yarn test` → all suites PASS.
- [ ] **Step 2: Build compiles** — Run: `yarn build` → no TypeScript errors, `dist/` produced.
- [ ] **Step 3: App boots** — Run: `yarn dev`, then `curl localhost:4000/healthz` → `{"status":"ok"}`. Stop the server.
- [ ] **Step 4: Confirm personal identity on history** — Run: `git log --format='%an <%ae>' | sort -u` → only `Muffing21 <96890792+Muffing21@users.noreply.github.com>`.
- [ ] **Step 5: Push** — `git push` (repo: `github.com/Muffing21/my-anime-catalog`, private).

## Notes / conventions recap
- Two id spaces: **AniList id** on `GET /anime/:anilistId` and `POST /list {anilistId}`; **local `anime.id` uuid** on `PATCH/DELETE /list/:animeId`.
- Only three code paths touch AniList: `search`, add-to-list on miss, view-one on miss — all through `services/anilist.service.ts`.
- Tests never hit the live network: `anilistService` is mocked. Tests run against the `anime_catalog_test` DB with migrations applied in `tests/setup.ts`; `resetDb()` truncates between tests.
- `utils/pagination.helper.ts` from the spec's folder listing is intentionally **not** built in v1 — the list endpoint only needs filter + sort (both implemented). Add it if/when a paginated endpoint appears.
