import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults, validateConfig, createStore } from "../src/store.js";
test("reject invalid roles, duplicate themes, missing core fields and excessive modal fields", () => {
  assert.doesNotThrow(() => validateConfig(defaults));
  const invalidRole = structuredClone(defaults);
  invalidRole.supportRoleId = "bad";
  assert.throws(() => validateConfig(invalidRole));
  const duplicates = structuredClone(defaults);
  duplicates.themes[1].id = duplicates.themes[0].id;
  assert.throws(() => validateConfig(duplicates));
  const missing = structuredClone(defaults);
  missing.fields[0].required = false;
  assert.throws(() => validateConfig(missing));
  const overflow = structuredClone(defaults);
  overflow.fields.push(
    ...[1, 2, 3, 4].map((id) => ({
      id: `x${id}`,
      label: "extra",
      required: false,
      style: "short",
    })),
  );
  assert.throws(() => validateConfig(overflow));
});
test("config, sessions and archived conversations survive database reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "clank-"));
  let store;
  try {
    store = createStore(dir);
    const c = store.config();
    c.panelTitle = "Support";
    store.saveConfig(c);
    store.putSession("session", { user: { id: "123" } });
    store.putSession("expired", {}, -1);
    assert.equal(store.session("expired"), null);
    const result = store.db
      .prepare(
        "INSERT INTO tickets(channel_id,user_id,title,theme,answers,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run("chan", "user", "Title", "Bug", "{}", new Date().toISOString());
    const id = Number(result.lastInsertRowid);
    const m = {
      id: "msg",
      author: { id: "user", username: "Kevin" },
      content: "Original",
      attachments: new Map(),
      createdAt: new Date(),
    };
    store.saveMessage(id, m);
    store.saveMessage(id, { ...m, content: "Edited" });
    assert.equal(store.messages(id).length, 1);
    store.db.close();
    store = createStore(dir);
    assert.equal(store.config().panelTitle, "Support");
    assert.equal(store.session("session").user.id, "123");
    assert.equal(store.messages(id)[0].content, "Edited");
    store.deleteSession("session");
    assert.equal(store.session("session"), null);
  } finally {
    store?.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
