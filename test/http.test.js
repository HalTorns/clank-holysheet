import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
    for (let i = 0; i < 60; i++) {
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
  } finally {
    const exit = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exit;
    rmSync(directory, { recursive: true, force: true });
  }
});
