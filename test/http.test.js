import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { createStore } from "../src/store.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

test("HTTP protects data and rejects invalid OAuth callbacks without Discord credentials", async () => {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const directory = mkdtempSync(join(tmpdir(), "clank-http-"));
  const seed = createStore(directory);
  seed.putSession("owner-session", {
    user: { id: "owner", name: "Demandeur" },
    csrf: "test-csrf",
  });
  for (const [channel, user] of [
    ["one", "owner"],
    ["two", "someone-else"],
  ])
    seed.db
      .prepare(
        "INSERT INTO tickets(channel_id,user_id,title,theme,answers,status,created_at,channel_deleted) VALUES(?,?,?,?,?,'closed',?,1)",
      )
      .run(
        channel,
        user,
        "Archive privée",
        "Bug",
        "{}",
        new Date().toISOString(),
      );
  seed.db
    .prepare(
      "INSERT INTO attachments(id,ticket_id,name,filename) VALUES(?,?,?,?)",
    )
    .run("12345678901234567", 1, "note.txt", "1-file");
  seed.db.close();
  mkdirSync(join(directory, "attachments"));
  writeFileSync(join(directory, "attachments", "1-file"), "private fixture");
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://localhost:${port}`,
      NODE_ENV: "development",
      DATA_DIR: directory,
      DISCORD_BOT_TOKEN: "",
      DISCORD_CLIENT_ID: "",
      DISCORD_CLIENT_SECRET: "",
      DISCORD_GUILD_ID: "",
    },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try {
        ready = (await fetch(`${base}/health`)).ok;
        if (ready) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, "server should start");
    for (const path of [
      "/api/me",
      "/api/config",
      "/api/tickets",
      "/api/projects",
      "/api/audit",
    ])
      assert.equal((await fetch(base + path)).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
    assert.equal((await fetch(base + "/api/tickets/1/archive")).status, 401);
    assert.equal(
      (await fetch(base + "/auth/callback?state=invalid&code=invalid")).status,
      400,
    );
    assert.equal((await fetch(base + "/auth/login")).status, 503);
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(
      page.headers.get("content-security-policy"),
      /default-src 'self'/,
    );
    assert.equal((await fetch(base + "/.env")).status, 404);
    assert.equal((await fetch(base + "/data/clank.sqlite")).status, 404);
    const headers = { Cookie: "clank=owner-session" };
    const mine = await fetch(base + "/api/tickets", { headers });
    assert.equal(mine.status, 200);
    assert.deepEqual(
      (await mine.json()).map((t) => t.id),
      [1],
    );
    assert.equal(
      (await fetch(base + "/api/tickets/1", { headers })).status,
      200,
    );
    assert.equal(
      (await fetch(base + "/api/tickets/2", { headers })).status,
      404,
    );
    assert.equal(
      (await fetch(base + "/api/tickets/2/archive", { headers })).status,
      404,
    );
    assert.equal((await fetch(base + "/api/config", { headers })).status, 403);
    assert.equal((await fetch(base + "/api/audit", { headers })).status, 403);
    const attachment = await fetch(
      base + "/api/tickets/1/attachments/12345678901234567",
      { headers },
    );
    assert.equal(attachment.status, 200);
    assert.equal(await attachment.text(), "private fixture");
    assert.equal(
      (
        await fetch(base + "/api/tickets/2/attachments/12345678901234567", {
          headers,
        })
      ).status,
      404,
    );
    assert.equal(
      (await fetch(base + "/api/tickets/1/attachments/12345678901234567"))
        .status,
      401,
    );
    const mutation = {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "X-CSRF-Token": "test-csrf",
        Origin: `http://localhost:${port}`,
      },
      body: JSON.stringify({ solutionId: 1 }),
    };
    assert.equal(
      (await fetch(base + "/api/tickets/2/accept", mutation)).status,
      404,
    );
    assert.equal(
      (await fetch(base + "/api/tickets/1/reply", mutation)).status,
      403,
    );
    assert.equal(
      (await fetch(base + "/api/tickets/1/close", mutation)).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/logout", {
          ...mutation,
          headers: { ...mutation.headers, Origin: "https://other.example" },
        })
      ).status,
      403,
    );
  } finally {
    const exit = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exit;
    rmSync(directory, { recursive: true, force: true });
  }
});
