import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/store.js";
test("existing database is migrated without losing tickets or deleting legacy closed channels", () => {
  const dir = mkdtempSync(join(tmpdir(), "clank-migration-"));
  let db = new DatabaseSync(join(dir, "clank.sqlite"));
  try {
    db.exec(
      "CREATE TABLE tickets(id INTEGER PRIMARY KEY AUTOINCREMENT,channel_id TEXT UNIQUE,user_id TEXT NOT NULL,title TEXT NOT NULL,theme TEXT NOT NULL,answers TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',assignee TEXT,created_at TEXT NOT NULL,closed_at TEXT)",
    );
    db.prepare(
      "INSERT INTO tickets(channel_id,user_id,title,theme,answers,status,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      "old-channel",
      "owner",
      "Historique",
      "Bug",
      "{}",
      "closed",
      "2026-10-13",
    );
    db.close();
    db = null;
    const store = createStore(dir);
    try {
      assert.equal(store.ticket(1).title, "Historique");
      assert.equal(store.ticket(1).channel_deleted, 1);
      assert.deepEqual(store.responses(1), []);
      assert.equal(store.ownTickets("other").length, 0);
    } finally {
      store.db.close();
    }
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
