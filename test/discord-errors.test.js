import { test } from "node:test";
import assert from "node:assert/strict";
import { configuredGuild, discordErrorInfo } from "../src/discord-errors.js";
const id = "1559231842245419129";
test("server ID is validated and bot membership checked before contacting Discord", async () => {
  const client = {
    isReady: () => true,
    guilds: {
      cache: new Map(),
      fetch: () => assert.fail("should not request an inaccessible guild"),
    },
  };
  await assert.rejects(
    () => configuredGuild(client, "https://discord.com/channels/123"),
    (e) => e.code === "CLANK_GUILD_ID",
  );
  await assert.rejects(
    () => configuredGuild(client, id),
    (e) => e.code === "CLANK_GUILD_NOT_JOINED",
  );
  client.guilds.cache.set(id, {});
  client.guilds.fetch = async (fetched) => ({ id: fetched });
  assert.equal((await configuredGuild(client, ` ${id}\n`)).id, id);
});
test("diagnostics distinguish missing access and permissions without exposing error payloads", () => {
  assert.match(discordErrorInfo({ code: 50001 }).message, /Accès au serveur/);
  assert.match(discordErrorInfo({ code: 50013 }).message, /Permissions/);
  const secret = "secret-should-never-be-logged";
  assert.equal(
    discordErrorInfo({
      code: secret,
      message: secret,
      requestBody: { token: secret },
    }).code,
    "INCONNUE",
  );
  assert.equal(
    JSON.stringify(discordErrorInfo({ message: secret })).includes(secret),
    false,
  );
});
