import { test } from "node:test";
import assert from "node:assert/strict";
import { persistConfiguration } from "../src/configuration.js";
import { defaults } from "../src/store.js";
import {
  suggestSettings,
  ticketConfigurationChanged,
  ticketReadiness,
} from "../public/settings.js";

function fixture() {
  let config = structuredClone(defaults);
  const events = [];
  return {
    events,
    store: {
      saveConfig: (c) => {
        config = structuredClone(c);
        events.push("save");
      },
      config: () => config,
      audit: (_, action) => events.push(action),
    },
    config: {
      ...config,
      supportRoleId: "support",
      panelChannelId: "panel",
      ticketCategoryId: "category",
    },
  };
}
test("activating incomplete tickets does not persist an unusable configuration", async () => {
  const f = fixture();
  f.config.supportRoleId = "";
  await assert.rejects(
    () =>
      persistConfiguration({
        store: f.store,
        bot: { publishPanel: () => assert.fail() },
        config: f.config,
        actor: "admin",
        publish: true,
      }),
    /Choisissez/,
  );
  assert.deepEqual(f.events, []);
});
test("one save publishes the panel and returns its new message ID", async () => {
  const f = fixture(),
    bot = {
      publishPanel: async () => {
        f.store.config().panelMessageId = "published-message";
        f.events.push("publish");
      },
    };
  const result = await persistConfiguration({
    store: f.store,
    bot,
    config: f.config,
    actor: "admin",
    publish: true,
  });
  assert.equal(result.panelPublished, true);
  assert.equal(result.panelMessageId, "published-message");
  assert.deepEqual(f.events, [
    "save",
    "config.update",
    "publish",
    "panel.publish",
  ]);
});
test("failed publication keeps saved configuration and reports partial success for retry", async () => {
  const f = fixture();
  f.config.panelTitle = "Nouveau panneau";
  const result = await persistConfiguration({
    store: f.store,
    bot: {
      publishPanel: async () => {
        throw Object.assign(Error("private payload"), { code: 50013 });
      },
    },
    config: f.config,
    actor: "admin",
    publish: true,
  });
  assert.equal(result.saved, true);
  assert.equal(result.panelPublished, false);
  assert.match(result.warning, /Réglages enregistrés/);
  assert.equal(f.store.config().panelTitle, "Nouveau panneau");
  assert.ok(f.events.includes("panel.publish_failed"));
  assert.equal(JSON.stringify(result).includes("private payload"), false);
});
test("suggestions preserve existing choices and avoid ambiguous or admin role assignments", () => {
  const saved = structuredClone(defaults);
  saved.teamRoleId = "already-chosen";
  const resources = {
    roles: [
      { id: "team", name: "Holysheet · Équipe" },
      { id: "support1", name: "Holysheet · Support" },
      { id: "support2", name: "Holysheet · Support" },
      { id: "admin", name: "Holysheet · Admin" },
    ],
    channels: [
      { id: "panel", name: "ouvrir-un-ticket", type: 0 },
      { id: "category", name: "HOLYSHEET · SUPPORT", type: 4 },
    ],
  };
  const { draft } = suggestSettings(saved, resources);
  assert.equal(draft.teamRoleId, "already-chosen");
  assert.equal(draft.supportRoleId, "");
  assert.equal(draft.adminRoleId, "");
  assert.equal(draft.panelChannelId, "panel");
  assert.equal(saved.panelChannelId, "");
  assert.equal(ticketReadiness(draft, resources).ready, false);
});
test("ticket edits still require publication when switching to the projects section", () => {
  const saved = structuredClone(defaults),
    draft = structuredClone(saved);
  draft.projectChannels[0].name = "nouveau";
  assert.equal(ticketConfigurationChanged(saved, draft), false);
  draft.themes[0].name = "Incident";
  assert.equal(ticketConfigurationChanged(saved, draft), true);
});
