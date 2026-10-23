import assert from "node:assert/strict";
import { describe, test } from "vite-plus/test";
import { roleLock, withRole } from "../src/ts/roles.ts";

describe("withRole", () => {
  test("adds a role in the order of the role table", () => {
    assert.deepEqual(withRole(["music_check", "admin"], "treasurer", true), [
      "admin",
      "treasurer",
      "music_check",
    ]);
  });

  test("removes a role and ignores roles already set", () => {
    assert.deepEqual(withRole(["admin", "treasurer"], "treasurer", false), [
      "admin",
    ]);
    assert.deepEqual(withRole(["treasurer"], "treasurer", true), ["treasurer"]);
  });
});

describe("roleLock", () => {
  const me = { id: "me", roles: ["admin"] };
  const other = { id: "other", roles: ["admin"] };

  test("admins can't drop their own Admin role", () => {
    assert.match(roleLock(me, "admin", "me", 2), /eigene/);
    assert.equal(roleLock(me, "treasurer", "me", 2), null);
  });

  test("the last Admin stays one", () => {
    assert.match(roleLock(other, "admin", "me", 1), /letzte/);
    assert.equal(roleLock(other, "admin", "me", 2), null);
  });

  test("granting Admin is never locked", () => {
    assert.equal(roleLock({ id: "x", roles: [] }, "admin", "me", 1), null);
  });
});
