import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/store.js";
import { archiveAttachments } from "../src/attachments.js";
test("archive saves Discord files once and rejects non-Discord sources", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clank-files-")),
    store = createStore(dir),
    originalFetch = globalThis.fetch;
  try {
    const id = Number(
      store.db
        .prepare(
          "INSERT INTO tickets(channel_id,user_id,title,theme,answers,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run("chan", "owner", "Files", "Bug", "{}", new Date().toISOString())
        .lastInsertRowid,
    );
    const attachmentId = "12345678901234567";
    let downloads = 0;
    globalThis.fetch = async () => {
      downloads++;
      return new Response("saved content");
    };
    store.saveMessage(id, {
      id: "m1",
      author: { id: "owner", username: "Owner" },
      content: "file",
      createdAt: new Date(),
      attachments: new Map([
        [
          attachmentId,
          {
            id: attachmentId,
            name: "file.txt",
            url: `https://cdn.discordapp.com/attachments/12345678901234568/${attachmentId}/file.txt`,
          },
        ],
      ]),
    });
    await archiveAttachments(store, id);
    await archiveAttachments(store, id);
    assert.equal(downloads, 1);
    const file = store.db
      .prepare("SELECT * FROM attachments WHERE id=?")
      .get(attachmentId);
    assert.equal(
      readFileSync(join(dir, "attachments", file.filename), "utf8"),
      "saved content",
    );
    store.saveMessage(id, {
      id: "m2",
      author: { id: "owner", username: "Owner" },
      content: "file",
      createdAt: new Date(),
      attachments: new Map([
        [
          "x",
          {
            id: "12345678901234569",
            name: "blocked.txt",
            url: "https://other.example/file",
          },
        ],
      ]),
    });
    await assert.rejects(
      () => archiveAttachments(store, id),
      /ne peut pas être archivée/,
    );
    assert.equal(downloads, 1);
  } finally {
    globalThis.fetch = originalFetch;
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
