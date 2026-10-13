import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/store.js";
import {
  createTicketService,
  canReadTicket,
  ticketControls,
} from "../src/tickets.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "clank-ticket-")),
    store = createStore(dir);
  const id = Number(
    store.db
      .prepare(
        "INSERT INTO tickets(channel_id,user_id,title,theme,answers,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        "channel",
        "owner",
        "Ma demande",
        "Bug",
        "{}",
        new Date().toISOString(),
      ).lastInsertRowid,
  );
  const state = {
    sent: [],
    deleted: 0,
    dm: [],
    deleteFails: false,
    dmFails: false,
    snapshotFails: false,
  };
  let serial = 0;
  const channel = {
    send: async (payload) => {
      state.sent.push(payload);
      return {
        id: `message-${++serial}`,
        author: { id: "bot", username: "Clank" },
        content: payload.content || "",
        embeds: (payload.embeds || []).map((e) => e.toJSON()),
        attachments: new Map(),
        createdAt: new Date(),
      };
    },
    delete: async () => {
      assert.equal(
        store.ticket(id).status,
        "closed",
        "archive must be committed before deletion",
      );
      assert.ok(store.messages(id).length);
      if (state.deleteFails)
        throw Object.assign(Error("denied"), { code: 50013 });
      state.deleted++;
    },
  };
  const client = {
    users: {
      fetch: async () => ({
        send: async (message) => {
          if (state.dmFails) throw Error("DM disabled");
          state.dm.push(message);
        },
      }),
    },
  };
  const locks = new Set();
  const service = createTicketService({
    store,
    client,
    guild: async () => ({ channels: { fetch: async () => channel } }),
    publicUrl: "https://clank.holysheet.fr",
    snapshot: async () => {
      if (state.snapshotFails) throw Error("Missing history");
      return channel;
    },
    locked: async (key, fn) => {
      if (locks.has(key)) throw Error("Busy");
      locks.add(key);
      try {
        return await fn();
      } finally {
        locks.delete(key);
      }
    },
  });
  return {
    id,
    store,
    state,
    service,
    cleanup: () => {
      store.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("only owner can read own ticket, support can read all, visitors cannot read others", () => {
  const t = { user_id: "owner" };
  assert.equal(canReadTicket({ id: "owner", support: false }, t), true);
  assert.equal(canReadTicket({ id: "other", support: false }, t), false);
  assert.equal(canReadTicket({ id: "staff", support: true }, t), true);
  assert.equal(canReadTicket({ id: "owner", support: false }, null), false);
});
test("claimed ticket accepts structured replies; only current solution and requester can close it", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      () => f.service.replyTicket(f.id, "Réponse", "staff", "solution"),
      /Prenez/,
    );
    await f.service.claimTicket(f.id, "staff");
    await assert.rejects(
      () => f.service.claimTicket(f.id, "other-staff"),
      /déjà pris/,
    );
    await f.service.replyTicket(
      f.id,
      "Merci de vérifier votre navigateur",
      "staff",
      "task",
    );
    assert.equal(f.store.ticket(f.id).pending_solution_id, null);
    const first = await f.service.replyTicket(
      f.id,
      "Première solution",
      "staff",
      "solution",
    );
    const latest = await f.service.replyTicket(
      f.id,
      "Solution corrigée",
      "staff",
      "solution",
    );
    await assert.rejects(
      () => f.service.closeTicket(f.id, "other", latest.responseId),
      /demandeur/,
    );
    await assert.rejects(
      () => f.service.closeTicket(f.id, "owner", first.responseId),
      /plus la solution/,
    );
    const result = await f.service.closeTicket(
      f.id,
      "owner",
      latest.responseId,
    );
    assert.equal(result.archived, true);
    assert.equal(f.store.ticket(f.id).status, "closed");
    assert.equal(f.state.deleted, 1);
    assert.equal(f.state.dm.length, 1);
    assert.equal(f.store.responses(f.id).at(-1).accepted_at !== null, true);
    assert.match(
      f.state.dm[0].components[0].toJSON().components[0].url,
      /view=mine&ticket=1/,
    );
    assert.ok(
      f.store
        .messages(f.id)
        .some((m) => m.content.includes("Solution corrigée")),
      "embed text must be archived",
    );
    await assert.rejects(
      () => f.service.closeTicket(f.id, "owner", latest.responseId),
      /déjà archivé/,
    );
    assert.equal(f.state.deleted, 1);
  } finally {
    f.cleanup();
  }
});
test("failed history capture leaves ticket open and channel intact", async () => {
  const f = fixture();
  try {
    await f.service.claimTicket(f.id, "staff");
    const r = await f.service.replyTicket(
      f.id,
      "Solution",
      "staff",
      "solution",
    );
    f.state.snapshotFails = true;
    await assert.rejects(() =>
      f.service.closeTicket(f.id, "owner", r.responseId),
    );
    assert.equal(f.store.ticket(f.id).status, "open");
    assert.equal(f.state.deleted, 0);
  } finally {
    f.cleanup();
  }
});
test("failed Discord deletion and blocked DMs never lose the archive; deletion is retryable", async () => {
  const f = fixture();
  try {
    await f.service.claimTicket(f.id, "staff");
    const r = await f.service.replyTicket(
      f.id,
      "Solution",
      "staff",
      "solution",
    );
    f.state.deleteFails = true;
    f.state.dmFails = true;
    const result = await f.service.closeTicket(f.id, "owner", r.responseId);
    assert.deepEqual(result, {
      archived: true,
      channelDeleted: false,
      dmSent: false,
    });
    assert.ok(f.store.messages(f.id).length);
    f.state.deleteFails = false;
    await f.service.deleteArchivedChannel(f.id);
    assert.equal(f.store.ticket(f.id).channel_deleted, 1);
  } finally {
    f.cleanup();
  }
});
test("reply controls contain a reply button and no direct close button", () => {
  const controls = ticketControls(7).toJSON().components;
  assert.equal(
    controls.some((c) => c.custom_id === "ticket:reply:7"),
    true,
  );
  assert.equal(
    controls.some((c) => c.custom_id?.startsWith("ticket:close:")),
    false,
  );
});
