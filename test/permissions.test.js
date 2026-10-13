import { test } from "node:test";
import assert from "node:assert/strict";
import { canSupport, canTeam } from "../src/bot.js";
const c = {
  teamRoleId: "team",
  supportRoleId: "support",
  adminRoleId: "admin",
};
const member = (roles = [], administrator = false) => ({
  permissions: { has: () => administrator },
  roles: { cache: new Map(roles.map((r) => [r, {}])) },
});
test("visitors cannot access support or projects", () => {
  assert.equal(canSupport(member(), c), false);
  assert.equal(canTeam(member(), c), false);
});
test("team membership does not expose tickets and support alone cannot create projects", () => {
  assert.equal(canSupport(member(["team"]), c), false);
  assert.equal(canTeam(member(["team"]), c), true);
  assert.equal(canSupport(member(["support"]), c), true);
  assert.equal(canTeam(member(["support"]), c), false);
});
test("Clank admins and Discord administrators can access both", () => {
  for (const m of [member(["admin"]), member([], true)]) {
    assert.equal(canSupport(m, c), true);
    assert.equal(canTeam(m, c), true);
  }
});
