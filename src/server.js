import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createStore, validateConfig } from "./store.js";
import { createBot } from "./bot.js";
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
    if (!bot.client.isReady())
      return res
        .status(503)
        .json({
          error:
            "Le bot se connecte à Discord. Réessayez dans quelques instants.",
        });
    const member = await (
      await bot.guild()
    ).members
      .fetch({ user: session.user.id, force: true })
      .catch(() => null);
    if (!member)
      return res
        .status(403)
        .json({ error: "Vous devez être membre du serveur Holysheet." });
    const c = store.config();
    const admin =
      bootstrap().includes(member.id) ||
      member.permissions.has(P.Administrator) ||
      Boolean(c.adminRoleId && member.roles.cache.has(c.adminRoleId));
    const support =
      admin ||
      Boolean(c.supportRoleId && member.roles.cache.has(c.supportRoleId));
    const team =
      admin || Boolean(c.teamRoleId && member.roles.cache.has(c.teamRoleId));
    if (!team && !support)
      return res
        .status(403)
        .json({ error: "Le dashboard est réservé à l’équipe et au Support." });
    req.actor = { ...session.user, admin, support, team };
    req.session = session;
    next();
  } catch {
    res.status(503).json({ error: "Vérification Discord indisponible." });
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
    return res
      .status(403)
      .json({
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
  store.putSession(id, { state }, 10 * 60000);
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
    res.redirect("/");
  }),
);
app.use("/api", identity, csrf);
app.get("/api/me", (req, res) =>
  res.json({
    user: req.actor,
    csrf: req.session.csrf,
    ready: bot.client.isReady(),
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
    for (const key of ["panelChannelId", "archiveChannelId"])
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
    store.saveConfig(c);
    store.audit(req.actor.id, "config.update");
    res.json({ ok: true, panelNeedsPublish: true });
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
app.get("/api/tickets", supportOnly, (_, res) => res.json(store.tickets()));
app.get("/api/tickets/:id", supportOnly, (req, res) => {
  const t = store.ticket(Number(req.params.id));
  if (!t) return res.status(404).json({ error: "Ticket introuvable." });
  res.json({ ticket: t, messages: store.messages(t.id) });
});
app.get("/api/tickets/:id/archive", supportOnly, (req, res) => {
  const t = store.ticket(Number(req.params.id));
  if (!t || t.status !== "closed")
    return res.status(404).json({ error: "Archive introuvable." });
  res
    .attachment(`ticket-${t.id}.json`)
    .json({ ticket: t, messages: store.messages(t.id) });
});
for (const action of ["claim", "close", "reply"])
  app.post(
    `/api/tickets/:id/${action}`,
    supportOnly,
    asyncRoute(async (req, res) => {
      const id = Number(req.params.id);
      if (action === "claim") await bot.claimTicket(id, req.actor.id);
      else if (action === "close") await bot.closeTicket(id, req.actor.id);
      else await bot.replyTicket(id, req.body.content, req.actor.id);
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
    store.db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 100").all(),
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
    .catch(() =>
      console.error(
        "Connexion du bot refusée. Vérifiez le token et Message Content Intent.",
      ),
    );
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
