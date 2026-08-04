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
