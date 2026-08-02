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
