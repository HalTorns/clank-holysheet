import { configuredGuild, logDiscordError } from "./discord-errors.js";
import {
  createTicketService,
  ticketControls,
  responseTypes,
} from "./tickets.js";
import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionFlagsBits as P,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  LabelBuilder,
} from "discord.js";

export const canSupport = (member, c) =>
  member.permissions.has(P.Administrator) ||
  [c.supportRoleId, c.adminRoleId].some(
    (id) => id && member.roles.cache.has(id),
  );
export const canTeam = (member, c) =>
  member.permissions.has(P.Administrator) ||
  Boolean(c.adminRoleId && member.roles.cache.has(c.adminRoleId)) ||
  Boolean(c.teamRoleId && member.roles.cache.has(c.teamRoleId));
export function createBot(store, env) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel],
  });
  const guild = () => configuredGuild(client, env.DISCORD_GUILD_ID);
  const locks = new Set();
  async function locked(key, fn) {
    if (locks.has(key)) throw Error("Une opération est déjà en cours.");
    locks.add(key);
    try {
      return await fn();
    } finally {
      locks.delete(key);
    }
  }
  const botOverwrite = () => ({
    id: client.user.id,
    allow: [
      P.ViewChannel,
      P.SendMessages,
      P.ReadMessageHistory,
      P.ManageChannels,
      P.ManageRoles,
      P.EmbedLinks,
      P.AttachFiles,
    ],
  });
  const staffOverwrites = (c) =>
    [...new Set([c.supportRoleId, c.adminRoleId].filter(Boolean))].map(
      (id) => ({
        id,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory],
      }),
    );
  async function snapshot(ticket) {
    const channel = await (await guild()).channels.fetch(ticket.channel_id);
    if (!channel?.isTextBased())
      throw Error(
        "Salon du ticket introuvable. L’archive ne peut pas être finalisée.",
      );
    let before;
    while (true) {
      const page = await channel.messages.fetch({
        limit: 100,
        ...(before ? { before } : {}),
      });
      for (const m of page.values()) store.saveMessage(ticket.id, m);
      if (page.size < 100) break;
      before = page.last().id;
    }
    return channel;
  }
  const {
    closeTicket,
    claimTicket,
    replyTicket,
    sendPortal,
    deleteArchivedChannel,
  } = createTicketService({
    store,
    guild,
    client,
    snapshot,
    locked,
    publicUrl: env.PUBLIC_URL || "http://localhost:3000",
  });
  async function publishPanel() {
    const c = store.config();
    const channel = await (await guild()).channels.fetch(c.panelChannelId);
    if (!channel?.isTextBased())
      throw Error("Choisissez un salon pour le panneau.");
    const payload = {
      embeds: [
        new EmbedBuilder()
          .setTitle(c.panelTitle)
          .setDescription(c.panelDescription)
          .setColor(0xb5f36c),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("ticket:theme")
            .setPlaceholder("Choisir le thème du ticket")
            .addOptions(c.themes.map((t) => ({ label: t.name, value: t.id }))),
        ),
      ],
    };
    if (c.panelMessageId) {
      const old = await channel.messages
        .fetch(c.panelMessageId)
        .catch(() => null);
      if (old) {
        await old.edit(payload);
        return;
      }
    }
    c.panelMessageId = (await channel.send(payload)).id;
    store.saveConfig(c);
  }
  async function setup(actor) {
    return locked("setup", async () => {
      const g = await guild(),
        c = store.config();
      // Persist each resource immediately: retrying never creates a second managed resource.
      for (const [key, name, color] of [
        ["teamRoleId", "Holysheet · Équipe", 0xb5f36c],
        ["supportRoleId", "Holysheet · Support", 0x83b8ff],
        ["adminRoleId", "Holysheet · Admin", 0xd8b4fe],
      ]) {
        if (!c[key]) {
          c[key] = (
            await g.roles.create({ name, color, reason: "Installation Clank" })
          ).id;
          store.saveConfig(c);
        }
      }
      const privateOverwrites = [
        { id: g.id, deny: [P.ViewChannel] },
        botOverwrite(),
        ...[c.teamRoleId, c.adminRoleId].map((id) => ({
          id,
          allow: [
            P.ViewChannel,
            P.SendMessages,
            P.ReadMessageHistory,
            P.Connect,
            P.Speak,
          ],
        })),
      ];
      c.setupIds ||= {};
      async function category(key, name, permissionOverwrites) {
        if (!c.setupIds[key]) {
          c.setupIds[key] = (
            await g.channels.create({
              name,
              type: ChannelType.GuildCategory,
              permissionOverwrites,
            })
          ).id;
          store.saveConfig(c);
        }
        return c.setupIds[key];
      }
      async function text(key, name, parent, options = {}) {
        if (!c.setupIds[key]) {
          c.setupIds[key] = (
            await g.channels.create({
              name,
              type: ChannelType.GuildText,
              parent,
              ...options,
            })
          ).id;
          store.saveConfig(c);
        }
        return c.setupIds[key];
      }
      const visitors = await category("visitors", "HOLYSHEET · VISITEURS", [
        {
          id: g.id,
          allow: [P.ViewChannel, P.ReadMessageHistory],
          deny: [P.SendMessages],
        },
        botOverwrite(),
      ]);
      c.panelChannelId ||= await text("panel", "ouvrir-un-ticket", visitors);
      store.saveConfig(c);
      const team = await category(
        "team",
        "HOLYSHEET · ÉQUIPE",
        privateOverwrites,
      );
      await text("general", "general", team);
      await text("files", "fichiers-et-photos", team);
      await text("projects", "creer-un-projet", team, {
        topic: "Utilisez /projet creer nom:... pour créer votre espace.",
      });
      if (!c.setupIds.meeting) {
        c.setupIds.meeting = (
          await g.channels.create({
            name: "Réunion",
            type: ChannelType.GuildVoice,
            parent: team,
          })
        ).id;
        store.saveConfig(c);
      }
      const supervision = await category(
        "supervision",
        "HOLYSHEET · SUPERVISION",
        privateOverwrites,
      );
      await text("monitor", "supervision", supervision);
      c.ticketCategoryId ||= await category("support", "HOLYSHEET · SUPPORT", [
        { id: g.id, deny: [P.ViewChannel] },
        botOverwrite(),
        ...staffOverwrites(c),
      ]);
      store.saveConfig(c);
      await publishPanel();
      store.audit(actor, "server.setup");
      return c;
    });
  }
  async function projectCreate(name, actor) {
    return locked(`project-create:${actor}`, async () => {
      if (!name?.trim() || name.length > 80)
        throw Error("Nom requis, 80 caractères maximum.");
      const g = await guild(),
        c = store.config();
      if (!c.teamRoleId) throw Error("Configurez le rôle Équipe.");
      const category = await g.channels.create({
        name: `PROJET - ${name.trim()}`,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          { id: g.id, deny: [P.ViewChannel] },
          botOverwrite(),
          ...[c.teamRoleId, c.adminRoleId].filter(Boolean).map((id) => ({
            id,
            allow: [
              P.ViewChannel,
              P.SendMessages,
              P.ReadMessageHistory,
              P.AttachFiles,
              P.Connect,
              P.Speak,
            ],
          })),
          {
            id: actor,
            allow: [
              P.ViewChannel,
              P.SendMessages,
              P.ReadMessageHistory,
              P.ManageChannels,
              P.ManageMessages,
              P.ManageRoles,
              P.Connect,
              P.Speak,
            ],
          },
        ],
      });
      const created = [];
      try {
        for (const template of c.projectChannels) {
          const channel = await g.channels.create({
            name: template.name,
            type:
              template.type === "voice"
                ? ChannelType.GuildVoice
                : ChannelType.GuildText,
            parent: category.id,
            ...(template.type === "text"
              ? { topic: template.description }
              : {}),
          });
          created.push(channel);
        }
        const first = created.find((ch) => ch.type === ChannelType.GuildText);
        if (first)
          await first.send({
            content: `**${name}**\nResponsable : <@${actor}>\n\nObjectif :\nPérimètre :\nDépôt :\nÉchéance :`,
            allowedMentions: { parse: [] },
          });
        store.db
          .prepare(
            "INSERT INTO projects(category_id,owner_id,name) VALUES(?,?,?)",
          )
          .run(category.id, actor, name.trim());
        store.audit(actor, `project.create:${category.id}`);
        return category;
      } catch (error) {
        for (const channel of created)
          await channel.delete("Annulation de création").catch(() => {});
        await category.delete("Annulation de création").catch(() => {});
        throw error;
      }
    });
  }
  async function projectAction(id, action, actor, admin, name) {
    return locked(`project:${id}`, async () => {
      const p = store.db.prepare("SELECT * FROM projects WHERE id=?").get(id);
      if (!p || p.status === "deleted" || (!admin && p.owner_id !== actor))
        throw Error("Projet inaccessible.");
      const g = await guild();
      await g.channels.fetch();
      const category = await g.channels.fetch(p.category_id);
      if (!category) throw Error("Catégorie introuvable.");
      if (action === "rename") {
        if (!name?.trim() || name.length > 80) throw Error("Nom invalide.");
        await category.setName(
          `${p.status === "archived" ? "ARCHIVE" : "PROJET"} - ${name}`,
        );
        store.db.prepare("UPDATE projects SET name=? WHERE id=?").run(name, id);
      } else if (action === "archive") {
        for (const ch of category.children.cache.values()) {
          await ch.permissionOverwrites.edit(store.config().teamRoleId, {
            SendMessages: false,
            Connect: false,
          });
          await ch.permissionOverwrites.edit(p.owner_id, {
            SendMessages: false,
            Connect: false,
          });
        }
        await category.setName(`ARCHIVE - ${p.name}`);
        store.db
          .prepare("UPDATE projects SET status='archived' WHERE id=?")
          .run(id);
      } else if (action === "delete") {
        for (const ch of category.children.cache.values())
          await ch.delete("Suppression du projet par son responsable");
        await category.delete();
        store.db
          .prepare("UPDATE projects SET status='deleted' WHERE id=?")
          .run(id);
      } else throw Error("Action invalide.");
      store.audit(actor, `project.${action}:${id}`);
    });
  }
  client.on("messageCreate", (m) => {
    const t = store.channelTicket(m.channelId);
    if (t) store.saveMessage(t.id, m);
  });
  client.on("messageUpdate", async (_, m) => {
    try {
      if (m.partial) m = await m.fetch();
      const t = store.channelTicket(m.channelId);
      if (t) store.saveMessage(t.id, m);
    } catch {
      console.error("Synchronisation d’un message impossible.");
    }
  });
  client.on("messageDelete", (m) =>
    store.db.prepare("UPDATE messages SET deleted=1 WHERE id=?").run(m.id),
  );
  client.on("channelDelete", (ch) => {
    store.db
      .prepare("UPDATE projects SET status='deleted' WHERE category_id=?")
      .run(ch.id);
  });
  client.on("interactionCreate", async (i) => {
    if (i.guildId !== String(env.DISCORD_GUILD_ID || "").trim()) return;
    try {
      const c = store.config();
      if (i.isStringSelectMenu() && i.customId === "ticket:theme") {
        const theme = c.themes.find((t) => t.id === i.values[0]);
        if (!theme) throw Error("Thème supprimé. Rechargez le panneau.");
        const modal = new ModalBuilder()
          .setCustomId(`ticket:new:${theme.id}`)
          .setTitle(theme.name.slice(0, 45));
        for (const field of c.fields)
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId(field.id)
                .setLabel(field.label)
                .setRequired(field.required)
                .setStyle(
                  field.style === "paragraph"
                    ? TextInputStyle.Paragraph
                    : TextInputStyle.Short,
                )
                .setMaxLength(field.id === "title" ? 100 : 2000),
            ),
          );
        await i.showModal(modal);
        return;
      }
      if (i.isModalSubmit() && i.customId.startsWith("ticket:new:")) {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await locked(`open:${i.user.id}`, async () => {
          if (
            store.db
              .prepare(
                "SELECT id FROM tickets WHERE user_id=? AND status='open'",
              )
              .get(i.user.id)
          )
            throw Error("Vous avez déjà un ticket ouvert.");
          const theme = c.themes.find((t) => t.id === i.customId.split(":")[2]);
          if (!theme) throw Error("Thème introuvable.");
          if (!c.supportRoleId || !c.ticketCategoryId)
            throw Error("Le support doit être configuré.");
          const answers = Object.fromEntries(
            i.fields.fields.map((f) => [f.customId, f.value]),
          );
          if (!answers.title?.trim() || !answers.description?.trim())
            throw Error("Titre et description requis.");
          const g = await guild();
          const channel = await g.channels.create({
            name: `ticket-${i.user.username}`.slice(0, 100),
            type: ChannelType.GuildText,
            parent: theme.categoryId || c.ticketCategoryId,
            permissionOverwrites: [
              { id: g.id, deny: [P.ViewChannel] },
              botOverwrite(),
              ...staffOverwrites(c),
              {
                id: i.user.id,
                allow: [
                  P.ViewChannel,
                  P.SendMessages,
                  P.ReadMessageHistory,
                  P.AttachFiles,
                ],
              },
            ],
          });
          const result = store.db
            .prepare(
              "INSERT INTO tickets(channel_id,user_id,title,theme,answers,created_at) VALUES(?,?,?,?,?,?)",
            )
            .run(
              channel.id,
              i.user.id,
              answers.title,
              theme.name,
              JSON.stringify(answers),
              new Date().toISOString(),
            );
          const id = Number(result.lastInsertRowid);
          store.audit(i.user.id, `ticket.create:${id}`);
          try {
            const m = await channel.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle(`#${id} · ${answers.title}`)
                  .setColor(0xb5f36c)
                  .addFields(
                    c.fields.map((f) => ({
                      name: f.label,
                      value: (answers[f.id] || "—").slice(0, 1024),
                    })),
                  )
                  .setFooter({ text: `Thème : ${theme.name}` }),
              ],
              components: [ticketControls(id)],
            });
            store.saveMessage(id, m);
            await i.editReply(`Ticket créé : <#${channel.id}>`);
          } catch (error) {
            // Keep the ticket and channel for recovery; the user can still use its link.
            await i.editReply(
              `Ticket créé : <#${channel.id}>. Le message d’accueil n’a pas pu être publié.`,
            );
            console.error("Publication du message d’accueil impossible.");
          }
          await sendPortal(store.ticket(id), false);
        });
        return;
      }
      if (i.isButton() && i.customId.startsWith("ticket:accept:")) {
        const [, , id, responseId] = i.customId.split(":");
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await closeTicket(Number(id), i.user.id, Number(responseId));
        await i.editReply(
          "Solution validée. Le ticket est archivé dans Mes tickets sur le dashboard.",
        );
        return;
      }
      const member = await (
        await guild()
      ).members.fetch({ user: i.user.id, force: true });
      if (i.isModalSubmit() && i.customId.startsWith("ticket:response:")) {
        if (!canSupport(member, c)) throw Error("Action réservée au Support.");
        const id = Number(i.customId.split(":")[2]);
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await replyTicket(
          id,
          i.fields.getTextInputValue("response_content"),
          i.user.id,
          i.fields.getStringSelectValues("response_kind")[0],
        );
        await i.editReply(
          "Réponse publiée. Une solution doit être validée par le demandeur pour archiver le ticket.",
        );
        return;
      }
      if (i.isButton() && i.customId.startsWith("ticket:")) {
        if (!canSupport(member, c)) throw Error("Action réservée au Support.");
        const [, action, id] = i.customId.split(":");
        if (action === "reply") {
          const t = store.ticket(Number(id));
          if (!t || t.status !== "open" || t.assignee !== i.user.id)
            throw Error("Prenez ce ticket en charge avant de répondre.");
          const modal = new ModalBuilder()
            .setCustomId(`ticket:response:${id}`)
            .setTitle("Répondre au ticket")
            .addLabelComponents(
              new LabelBuilder()
                .setLabel("Type de réponse")
                .setStringSelectMenuComponent(
                  new StringSelectMenuBuilder()
                    .setCustomId("response_kind")
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(
                      Object.entries(responseTypes).map(([value, label]) => ({
                        label,
                        value,
                      })),
                    ),
                ),
              new LabelBuilder()
                .setLabel("Votre réponse")
                .setTextInputComponent(
                  new TextInputBuilder()
                    .setCustomId("response_content")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(4000),
                ),
            );
          await i.showModal(modal);
          return;
        }
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        if (action === "claim") {
          await claimTicket(Number(id), i.user.id);
          await i.editReply(
            "Ticket pris en charge. Utilisez Répondre pour compléter le formulaire.",
          );
        } else if (action === "close")
          throw Error(
            "Proposez une solution via Répondre. Le demandeur doit la valider pour archiver le ticket.",
          );
        else throw Error("Action inconnue.");
        return;
      }
      if (i.isChatInputCommand() && i.commandName === "projet") {
        if (!canTeam(member, c)) throw Error("Action réservée à l’équipe.");
        const action = i.options.getSubcommand();
        if (action === "supprimer") {
          const id = i.options.getInteger("id", true),
            p = store.db.prepare("SELECT * FROM projects WHERE id=?").get(id);
          if (
            !p ||
            (p.owner_id !== i.user.id &&
              !member.permissions.has(P.Administrator) &&
              !(c.adminRoleId && member.roles.cache.has(c.adminRoleId)))
          )
            throw Error("Projet inaccessible.");
          await i.reply({
            content: `Supprimer définitivement « ${p.name} » et l’historique de ses salons ?`,
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`project:delete:${id}:${i.user.id}`)
                  .setLabel("Confirmer la suppression")
                  .setStyle(ButtonStyle.Danger),
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        if (action === "creer") {
          const category = await projectCreate(
            i.options.getString("nom", true),
            i.user.id,
          );
          await i.editReply(
            `Projet créé : **${category.name}**. Retrouvez son identifiant dans le dashboard.`,
          );
        } else {
          await projectAction(
            i.options.getInteger("id", true),
            action === "archiver" ? "archive" : "rename",
            i.user.id,
            member.permissions.has(P.Administrator) ||
              Boolean(c.adminRoleId && member.roles.cache.has(c.adminRoleId)),
            i.options.getString("nom"),
          );
          await i.editReply("Projet mis à jour.");
        }
        return;
      }
      if (i.isButton() && i.customId.startsWith("project:delete:")) {
        const [, , id, actor] = i.customId.split(":");
        if (actor !== i.user.id)
          throw Error("Confirmation personnelle requise.");
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await projectAction(
          Number(id),
          "delete",
          i.user.id,
          member.permissions.has(P.Administrator) ||
            Boolean(c.adminRoleId && member.roles.cache.has(c.adminRoleId)),
        );
        await i.editReply("Projet supprimé.");
      }
    } catch (error) {
      const payload = {
        content: error.message.slice(0, 1800),
        flags: MessageFlags.Ephemeral,
      };
      if (i.deferred || i.replied)
        await i.editReply({ content: payload.content }).catch(() => {});
      else await i.reply(payload).catch(() => {});
    }
  });
  client.once("clientReady", async () => {
    console.log("Clank connecté à Discord.");
    let stage = "Accès au serveur configuré";
    try {
      const targetGuild = await guild();
      console.log(`[Clank] Accès au serveur ${targetGuild.id} confirmé.`);
      stage = "Publication de la commande /projet";
      const command = new SlashCommandBuilder()
        .setName("projet")
        .setDescription("Gérer les projets Holysheet")
        .addSubcommand((s) =>
          s
            .setName("creer")
            .setDescription("Créer un projet")
            .addStringOption((o) =>
              o
                .setName("nom")
                .setDescription("Nom du projet")
                .setRequired(true)
                .setMaxLength(80),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("renommer")
            .setDescription("Renommer son projet")
            .addIntegerOption((o) =>
              o.setName("id").setDescription("ID du projet").setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName("nom")
                .setDescription("Nouveau nom")
                .setRequired(true)
                .setMaxLength(80),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("archiver")
            .setDescription("Archiver son projet")
            .addIntegerOption((o) =>
              o.setName("id").setDescription("ID du projet").setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName("supprimer")
            .setDescription("Supprimer définitivement son projet")
            .addIntegerOption((o) =>
              o.setName("id").setDescription("ID du projet").setRequired(true),
            ),
        );
      await targetGuild.commands.create(command);
      console.log("[Clank] Commande /projet publiée.");
      for (const t of store.tickets().filter((t) => t.status === "open"))
        await snapshot(t).catch(() =>
          console.error(`Rattrapage impossible pour le ticket ${t.id}.`),
        );
      for (const t of store
        .tickets()
        .filter((t) => t.status === "closed" && !t.channel_deleted))
        await deleteArchivedChannel(t.id);
    } catch (error) {
      logDiscordError(stage, error);
    }
  });
  return {
    client,
    guild,
    setup,
    publishPanel,
    closeTicket,
    claimTicket,
    replyTicket,
    projectCreate,
    projectAction,
    snapshot,
    sendPortal,
    deleteArchivedChannel,
  };
}
