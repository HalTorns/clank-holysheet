import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createStore, validateConfig } from "./store.js";
import { createBot } from "./bot.js";
import { canReadTicket } from "./tickets.js";
import { describeAudit } from "./audit.js";
import { persistConfiguration } from "./configuration.js";
import { discordErrorInfo, logDiscordError } from "./discord-errors.js";
import { PermissionFlagsBits as P, ChannelType } from "discord.js";

const env = process.env,
  production = env.NODE_ENV === "production";
const publicUrl = new URL(env.PUBLIC_URL || "http://localhost:3000");
if (production && publicUrl.protocol !== "https:")
  throw Error("PUBLIC_URL doit utiliser HTTPS en production.");
if (
  production &&
  [
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_BOT_TOKEN",
    "DISCORD_GUILD_ID",
  ].some((k) => !env[k])
)
  throw Error("Configuration Discord incomplète.");
const store = createStore(env.DATA_DIR || "./data");
const bot = createBot(store, env);
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "64kb" }));
app.use("/api", rateLimit({ windowMs: 60000, limit: 120 }));
app.use("/auth", rateLimit({ windowMs: 60000, limit: 20 }));
const token = () => randomBytes(32).toString("hex");
const cookieName = production ? "__Host-clank" : "clank";
function cookie(req) {
  return req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}
function setCookie(res, id, maxAge = 8 * 3600000) {
  res.cookie(cookieName, id, {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}
const bootstrap = () =>
  (env.ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
async function identity(req, res, next) {
  try {
    const session = store.session(cookie(req));
    if (!session?.user)
      return res.status(401).json({ error: "Connexion Discord requise." });
    let member = null,
      discordWarning = null;
    if (bot.client.isReady()) {
      try {
        member = await (
          await bot.guild()
        ).members.fetch({ user: session.user.id, force: true });
      } catch (error) {
        if (error.code !== 10007) {
          logDiscordError("Vérification des rôles", error);
          discordWarning = discordErrorInfo(error).message;
        }
      }
    } else
      discordWarning =
        "Le bot est hors ligne. Vos tickets conservés restent consultables.";
    const c = store.config();
    const admin = Boolean(
      member &&
      (bootstrap().includes(member.id) ||
        member.permissions.has(P.Administrator) ||
        (c.adminRoleId && member.roles.cache.has(c.adminRoleId))),
    );
    const support = Boolean(
      admin ||
      (member && c.supportRoleId && member.roles.cache.has(c.supportRoleId)),
    );
    const team = Boolean(
      admin || (member && c.teamRoleId && member.roles.cache.has(c.teamRoleId)),
    );
    req.actor = { ...session.user, admin, support, team };
    req.session = session;
    req.discordWarning = discordWarning;
    next();
  } catch (error) {
    logDiscordError("Lecture de la session", error);
    res.status(503).json({ error: discordErrorInfo(error).message });
  }
}
function csrf(req, res, next) {
  if (["GET", "HEAD"].includes(req.method)) return next();
  const a = req.headers["x-csrf-token"],
    b = req.session.csrf;
  if (
    req.headers.origin !== publicUrl.origin ||
    typeof a !== "string" ||
    a.length !== b.length ||
    !timingSafeEqual(Buffer.from(a), Buffer.from(b))
  )
    return res.status(403).json({
      error: "Session expirée ou requête non autorisée. Rechargez la page.",
    });
  next();
}
const adminOnly = (req, res, next) =>
  req.actor.admin
    ? next()
    : res.status(403).json({ error: "Accès administrateur requis." });
const supportOnly = (req, res, next) =>
  req.actor.support
    ? next()
    : res.status(403).json({ error: "Accès Support requis." });
const teamOnly = (req, res, next) =>
  req.actor.team
    ? next()
    : res.status(403).json({ error: "Accès Équipe requis." });
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
app.get("/health", (_, res) => res.json({ status: "ok" }));
app.get("/auth/login", (req, res) => {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET)
    return res
      .status(503)
      .send("Configurez les variables Discord pour activer la connexion.");
  const id = token(),
    state = token();
  let returnTo = "/";
  if (typeof req.query.next === "string") {
    const dest = new URL(req.query.next, publicUrl.origin);
    if (dest.origin === publicUrl.origin && dest.pathname === "/")
      returnTo = dest.pathname + dest.search;
  }
  store.putSession(id, { state, returnTo }, 10 * 60000);
  setCookie(res, id, 10 * 60000);
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: `${publicUrl.origin}/auth/callback`,
    response_type: "code",
    scope: "identify",
    state,
  }).toString();
  res.redirect(url.href);
});
app.get(
  "/auth/callback",
  asyncRoute(async (req, res) => {
    const oldId = cookie(req),
      pending = store.session(oldId);
    if (
      !pending?.state ||
      typeof req.query.state !== "string" ||
      req.query.state !== pending.state ||
      typeof req.query.code !== "string"
    )
      return res.status(400).send("Connexion expirée. Recommencez.");
    store.deleteSession(oldId);
    const r = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: req.query.code,
        redirect_uri: `${publicUrl.origin}/auth/callback`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error("Connexion Discord refusée.");
    const auth = await r.json();
    const u = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${auth.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!u.ok) throw Error("Profil Discord indisponible.");
    const user = await u.json(),
      id = token();
    store.putSession(id, {
      user: { id: user.id, name: user.global_name || user.username },
      csrf: token(),
    });
    setCookie(res, id);
    res.redirect(pending.returnTo || "/");
  }),
);
app.use("/api", identity, csrf);
app.get("/api/me", (req, res) =>
  res.json({
    user: req.actor,
    csrf: req.session.csrf,
    ready: bot.client.isReady(),
    discordWarning: req.discordWarning,
  }),
);
app.post("/api/logout", (req, res) => {
  store.deleteSession(cookie(req));
  setCookie(res, "", 0);
  res.json({ ok: true });
});
app.get("/api/config", adminOnly, (_, res) => res.json(store.config()));
app.put(
  "/api/config",
  adminOnly,
  asyncRoute(async (req, res) => {
    const previous = store.config(),
      c = validateConfig(req.body);
    c.setupIds = previous.setupIds;
    c.panelMessageId =
      c.panelChannelId === previous.panelChannelId
        ? previous.panelMessageId
        : "";
    const g = await bot.guild();
    for (const key of ["teamRoleId", "supportRoleId", "adminRoleId"])
      if (c[key] && !(await g.roles.fetch(c[key])))
        throw Error(`Rôle introuvable : ${key}`);
    for (const id of [
      ...new Set(
        [c.ticketCategoryId, ...c.themes.map((t) => t.categoryId)].filter(
          Boolean,
        ),
      ),
    ]) {
      const ch = await g.channels.fetch(id);
      if (ch?.type !== ChannelType.GuildCategory)
        throw Error("La destination des tickets doit être une catégorie.");
    }
    for (const key of ["panelChannelId"])
      if (c[key]) {
        const ch = await g.channels.fetch(c[key]);
        if (ch?.type !== ChannelType.GuildText)
          throw Error(`Salon texte requis : ${key}`);
      }
    // Changing support roles on live tickets requires a controlled migration, not a silent permission drift.
    if (
      ["supportRoleId", "adminRoleId"].some((k) => c[k] !== previous[k]) &&
      store.tickets().length
    )
      throw Error(
        "Les rôles Support/Admin ne peuvent pas être changés après création de tickets ; migrez les permissions avant de modifier la configuration.",
      );
    res.json(
      await persistConfiguration({
        store,
        bot,
        config: c,
        actor: req.actor.id,
        publish: req.query.publish === "1",
      }),
    );
  }),
);
app.get(
  "/api/resources",
  adminOnly,
  asyncRoute(async (_, res) => {
    const g = await bot.guild();
    await g.channels.fetch();
    await g.roles.fetch();
    res.json({
      roles: g.roles.cache
        .filter((r) => r.id !== g.id && !r.managed)
        .map((r) => ({ id: r.id, name: r.name })),
      channels: g.channels.cache
        .filter((ch) =>
          [ChannelType.GuildCategory, ChannelType.GuildText].includes(ch.type),
        )
        .map((ch) => ({ id: ch.id, name: ch.name, type: ch.type })),
    });
  }),
);
app.post(
  "/api/setup",
  adminOnly,
  asyncRoute(async (req, res) => res.json(await bot.setup(req.actor.id))),
);
app.post(
  "/api/panel",
  adminOnly,
  asyncRoute(async (_, res) => {
    await bot.publishPanel();
    res.json({ ok: true });
  }),
);
app.get("/api/tickets", (req, res) =>
  res.json(
    req.actor.support && req.query.scope !== "mine"
      ? store.tickets()
      : store.ownTickets(req.actor.id),
  ),
);
app.get("/api/tickets/:id", (req, res) => {
  const t = store.ticket(Number(req.params.id));
  if (!canReadTicket(req.actor, t))
    return res.status(404).json({ error: "Ticket introuvable." });
  const messages = store.messages(t.id).map((m) => ({
    ...m,
    attachments: JSON.stringify(
      JSON.parse(m.attachments).map((a) => {
        const id = a.id || new URL(a.url).pathname.split("/")[3];
        const saved = store.db
          .prepare("SELECT id FROM attachments WHERE id=? AND ticket_id=?")
          .get(id || "", t.id);
        return saved
          ? { ...a, url: `/api/tickets/${t.id}/attachments/${saved.id}` }
          : a;
      }),
    ),
  }));
  res.json({ ticket: t, messages, responses: store.responses(t.id) });
});
app.get("/api/tickets/:id/attachments/:attachmentId", (req, res) => {
  const t = store.ticket(Number(req.params.id));
  if (!canReadTicket(req.actor, t))
    return res.status(404).json({ error: "Pièce jointe introuvable." });
  const attachment = store.db
    .prepare("SELECT * FROM attachments WHERE id=? AND ticket_id=?")
    .get(req.params.attachmentId, t.id);
  if (!attachment)
    return res.status(404).json({ error: "Pièce jointe introuvable." });
  res.download(
    join(store.directory, "attachments", attachment.filename),
    attachment.name,
  );
});
app.get("/api/tickets/:id/archive", (req, res) => {
  const t = store.ticket(Number(req.params.id));
  if (!canReadTicket(req.actor, t) || t.status !== "closed")
    return res.status(404).json({ error: "Archive introuvable." });
  res.attachment(`ticket-${t.id}.json`).json({
    ticket: t,
    messages: store.messages(t.id),
    responses: store.responses(t.id),
  });
});
app.post(
  "/api/tickets/:id/accept",
  asyncRoute(async (req, res) => {
    const t = store.ticket(Number(req.params.id));
    if (!t || t.user_id !== req.actor.id)
      return res.status(404).json({ error: "Ticket introuvable." });
    if (!Number.isInteger(req.body.solutionId))
      throw Error("Solution requise.");
    res.json(await bot.closeTicket(t.id, req.actor.id, req.body.solutionId));
  }),
);
app.post(
  "/api/tickets/:id/close",
  adminOnly,
  asyncRoute(async (req, res) => {
    if (req.body.confirm !== true)
      throw Error("Confirmation de clôture administrative requise.");
    res.json(await bot.closeTicket(Number(req.params.id), req.actor.id));
  }),
);
app.post(
  "/api/tickets/:id/cleanup",
  supportOnly,
  asyncRoute(async (req, res) => {
    await bot.deleteArchivedChannel(Number(req.params.id));
    res.json({ ok: true });
  }),
);
for (const action of ["claim", "reply"])
  app.post(
    `/api/tickets/:id/${action}`,
    supportOnly,
    asyncRoute(async (req, res) => {
      const id = Number(req.params.id);
      if (action === "claim") await bot.claimTicket(id, req.actor.id);
      else
        await bot.replyTicket(
          id,
          req.body.content,
          req.actor.id,
          req.body.kind,
        );
      res.json({ ok: true });
    }),
  );
app.get("/api/projects", teamOnly, (_, res) =>
  res.json(store.db.prepare("SELECT * FROM projects ORDER BY id DESC").all()),
);
app.post(
  "/api/projects",
  teamOnly,
  asyncRoute(async (req, res) => {
    const c = await bot.projectCreate(req.body.name, req.actor.id);
    res.json({ id: c.id });
  }),
);
app.post(
  "/api/projects/:id/:action",
  teamOnly,
  asyncRoute(async (req, res) => {
    if (req.params.action === "delete" && req.body.confirm !== true)
      throw Error("Confirmation de suppression requise.");
    await bot.projectAction(
      Number(req.params.id),
      req.params.action,
      req.actor.id,
      req.actor.admin,
      req.body.name,
    );
    res.json({ ok: true });
  }),
);
app.get("/api/audit", adminOnly, (_, res) =>
  res.json(
    store.db
      .prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 100")
      .all()
      .map((row) => describeAudit(row, store, bot.client)),
  ),
);
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
app.use((error, req, res, _next) => {
  console.error("Requête échouée", req.method, req.path, error.name);
  res
    .status(400)
    .json({ error: error.message?.slice(0, 400) || "Opération impossible." });
});
const server = app.listen(Number(env.PORT || 3000), "0.0.0.0", () =>
  console.log("Dashboard Clank démarré."),
);
if (env.DISCORD_BOT_TOKEN)
  bot.client
    .login(env.DISCORD_BOT_TOKEN)
    .catch((error) => logDiscordError("Connexion du bot", error));
const shutdown = () => {
  bot.client.destroy();
  server.close(() => {
    store.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
