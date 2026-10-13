import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const defaults = {
  teamRoleId: "",
  supportRoleId: "",
  adminRoleId: "",
  ticketCategoryId: "",
  archiveChannelId: "",
  panelChannelId: "",
  panelMessageId: "",
  themes: ["Bug", "Demande", "Projet", "Question", "Autre"].map((name, i) => ({
    id: String(i + 1),
    name,
    categoryId: "",
  })),
  panelTitle: "Support Holysheet",
  panelDescription: "Choisissez un thème pour ouvrir un ticket privé.",
  fields: [
    { id: "title", label: "Nom du ticket", required: true, style: "short" },
    {
      id: "description",
      label: "Description",
      required: true,
      style: "paragraph",
    },
  ],
  projectChannels: [
    {
      name: "cadrage",
      type: "text",
      description: "Objectif, périmètre, responsable, dépôt et échéance.",
    },
    {
      name: "discussion",
      type: "text",
      description: "Échanges autour du projet.",
    },
    {
      name: "boite-a-idees",
      type: "text",
      description: "Propositions et pistes à explorer.",
    },
    {
      name: "liens-utiles",
      type: "text",
      description: "Dépôts, documentation et ressources.",
    },
    {
      name: "decisions",
      type: "text",
      description: "Décisions techniques et raisons associées.",
    },
    { name: "Atelier", type: "voice", description: "" },
  ],
};
const snowflake = /^\d{17,20}$/;
export function validateConfig(input) {
  const c = structuredClone(input);
  for (const key of [
    "teamRoleId",
    "supportRoleId",
    "adminRoleId",
    "ticketCategoryId",
    "archiveChannelId",
    "panelChannelId",
  ]) {
    if (typeof c[key] !== "string" || (c[key] && !snowflake.test(c[key])))
      throw Error(`Identifiant invalide : ${key}`);
  }
  if (!Array.isArray(c.themes) || c.themes.length < 1 || c.themes.length > 25)
    throw Error("Entre 1 et 25 thèmes sont requis.");
  const ids = new Set();
  for (const t of c.themes) {
    if (
      !/^[a-zA-Z0-9_-]{1,40}$/.test(t.id) ||
      ids.has(t.id) ||
      typeof t.name !== "string" ||
      !t.name.trim() ||
      t.name.length > 100 ||
      typeof t.categoryId !== "string" ||
      (t.categoryId && !snowflake.test(t.categoryId))
    )
      throw Error("Thème invalide ou identifiant dupliqué.");
    ids.add(t.id);
  }
  if (!Array.isArray(c.fields) || c.fields.length < 2 || c.fields.length > 5)
    throw Error("Le formulaire accepte de 2 à 5 champs.");
  const fieldIds = new Set();
  for (const f of c.fields) {
    if (
      !/^[a-zA-Z0-9_-]{1,40}$/.test(f.id) ||
      fieldIds.has(f.id) ||
      typeof f.label !== "string" ||
      !f.label.trim() ||
      f.label.length > 45 ||
      !["short", "paragraph"].includes(f.style) ||
      typeof f.required !== "boolean"
    )
      throw Error("Champ invalide.");
    fieldIds.add(f.id);
  }
  if (
    !["title", "description"].every((id) =>
      c.fields.some((f) => f.id === id && f.required),
    )
  )
    throw Error("Titre et description doivent rester obligatoires.");
  if (
    typeof c.panelTitle !== "string" ||
    !c.panelTitle.trim() ||
    c.panelTitle.length > 256 ||
    typeof c.panelDescription !== "string" ||
    c.panelDescription.length > 4096
  )
    throw Error("Texte du panneau invalide.");
  if (
    !Array.isArray(c.projectChannels) ||
    !c.projectChannels.length ||
    c.projectChannels.length > 20
  )
    throw Error("Entre 1 et 20 salons par projet.");
  const names = new Set();
  for (const p of c.projectChannels) {
    if (
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 100 ||
      names.has(p.name) ||
      !["text", "voice"].includes(p.type) ||
      typeof p.description !== "string" ||
      p.description.length > 1024
    )
      throw Error("Salon projet invalide.");
    names.add(p.name);
  }
  return c;
}
export function createStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, "clank.sqlite"));
  db.exec(
    `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS config(id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT UNIQUE, user_id TEXT NOT NULL, title TEXT NOT NULL, theme TEXT NOT NULL, answers TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', assignee TEXT, created_at TEXT NOT NULL, closed_at TEXT); CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, ticket_id INTEGER NOT NULL, author TEXT NOT NULL, author_id TEXT NOT NULL, content TEXT NOT NULL, attachments TEXT NOT NULL, created_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY AUTOINCREMENT, category_id TEXT UNIQUE NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active'); CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, created_at TEXT);`,
  );
  db.prepare("INSERT OR IGNORE INTO config VALUES(1, ?)").run(
    JSON.stringify(defaults),
  );
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(tickets)")
      .all()
      .map((c) => c.name),
  );
  for (const [name, type] of [
    ["pending_solution_id", "INTEGER"],
    ["channel_deleted", "INTEGER NOT NULL DEFAULT 0"],
    ["dm_sent", "INTEGER NOT NULL DEFAULT 0"],
  ]) {
    if (!columns.has(name))
      db.exec(`ALTER TABLE tickets ADD COLUMN ${name} ${type}`);
  }
  if (!columns.has("channel_deleted"))
    db.exec("UPDATE tickets SET channel_deleted=1 WHERE status='closed'");
  db.exec(
    "CREATE TABLE IF NOT EXISTS responses(id INTEGER PRIMARY KEY AUTOINCREMENT,ticket_id INTEGER NOT NULL,kind TEXT NOT NULL,actor TEXT NOT NULL,content TEXT NOT NULL,message_id TEXT,created_at TEXT NOT NULL,accepted_at TEXT)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,ticket_id INTEGER NOT NULL,name TEXT NOT NULL,filename TEXT NOT NULL)",
  );
  return {
    db,
    directory: resolve(directory),
    config: () =>
      JSON.parse(db.prepare("SELECT value FROM config WHERE id=1").get().value),
    saveConfig: (c) =>
      db.prepare("UPDATE config SET value=? WHERE id=1").run(JSON.stringify(c)),
    tickets: () => db.prepare("SELECT * FROM tickets ORDER BY id DESC").all(),
    ownTickets: (userId) =>
      db
        .prepare("SELECT * FROM tickets WHERE user_id=? ORDER BY id DESC")
        .all(userId),
    responses: (id) =>
      db
        .prepare("SELECT * FROM responses WHERE ticket_id=? ORDER BY id")
        .all(id),
    ticket: (id) => db.prepare("SELECT * FROM tickets WHERE id=?").get(id),
    channelTicket: (id) =>
      db.prepare("SELECT * FROM tickets WHERE channel_id=?").get(id),
    messages: (id) =>
      db
        .prepare(
          "SELECT * FROM messages WHERE ticket_id=? ORDER BY created_at, id",
        )
        .all(id),
    saveMessage(ticketId, m) {
      db.prepare(
        "INSERT INTO messages(id,ticket_id,author,author_id,content,attachments,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,attachments=excluded.attachments,author=excluded.author",
      ).run(
        m.id,
        ticketId,
        m.author?.username || "Inconnu",
        m.author?.id || "",
        m.content ||
          (m.embeds || [])
            .map((e) =>
              [
                e.title,
                e.description,
                ...(e.fields || []).map((f) => `${f.name} : ${f.value}`),
              ]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n\n"),
        JSON.stringify(
          [...m.attachments.values()].map((a) => ({
            id: a.id,
            name: a.name,
            url: a.url,
          })),
        ),
        m.createdAt.toISOString(),
      );
    },
    audit: (actor, action) =>
      db
        .prepare("INSERT INTO audit(actor,action,created_at) VALUES(?,?,?)")
        .run(actor, action, new Date().toISOString()),
    session(id) {
      if (typeof id !== "string") return null;
      const row = db
        .prepare("SELECT * FROM sessions WHERE id=? AND expires>?")
        .get(id, Date.now());
      return row ? JSON.parse(row.value) : null;
    },
    putSession(id, value, lifetime = 8 * 3600000) {
      db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
      db.prepare("INSERT OR REPLACE INTO sessions VALUES(?,?,?)").run(
        id,
        JSON.stringify(value),
        Date.now() + lifetime,
      );
    },
    deleteSession: (id) =>
      db.prepare("DELETE FROM sessions WHERE id=?").run(id),
  };
}
