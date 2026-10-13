import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { archiveAttachments } from "./attachments.js";

export const responseTypes = {
  task: "Tâche",
  question: "Question",
  solution: "Solution",
};
export function ticketChannelName(id, subject) {
  const prefix = `ticket-${String(id).padStart(4, '0')}-`;
  const slug = subject.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'demande';
  return (prefix + slug).slice(0, 100).replace(/-+$/g, '');
}
export function canReadTicket(actor, ticket) {
  return Boolean(ticket && (actor.support || ticket.user_id === actor.id));
}
export function ticketControls(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:claim:${id}`)
      .setLabel("Prendre en charge")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket:reply:${id}`)
      .setLabel("Répondre")
      .setStyle(ButtonStyle.Secondary),
  );
}
export function createTicketService({
  store,
  guild,
  client,
  snapshot,
  locked,
  publicUrl,
}) {
  const portalUrl = (id) =>
    `${new URL(publicUrl).origin}/?view=mine${id ? `&ticket=${id}` : ""}`;
  async function sendPortal(ticket, archived) {
    try {
      const user = await client.users.fetch(ticket.user_id);
      await user.send({
        content: archived
          ? `Votre ticket #${ticket.id} « ${ticket.title} » est archivé. Retrouvez votre conversation et tous vos tickets :`
          : `Votre ticket #${ticket.id} « ${ticket.title} » est ouvert. Vous pouvez consulter vos tickets ici :`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel("Consulter mes tickets")
              .setStyle(ButtonStyle.Link)
              .setURL(portalUrl(ticket.id)),
          ),
        ],
        allowedMentions: { parse: [] },
      });
      store.db
        .prepare("UPDATE tickets SET dm_sent=1 WHERE id=?")
        .run(ticket.id);
      store.audit("Clank", `ticket.dm:${ticket.id}`);
    } catch {
      store.db
        .prepare("UPDATE tickets SET dm_sent=0 WHERE id=?")
        .run(ticket.id);
      store.audit("Clank", `ticket.dm_failed:${ticket.id}`);
      console.warn(
        `[Clank] Ticket #${ticket.id} : message privé non remis. Le demandeur peut accéder à Mes tickets sur le dashboard.`,
      );
    }
  }
  async function deleteArchivedChannel(id) {
    const t = store.ticket(id);
    if (!t || t.status !== "closed" || t.channel_deleted) return;
    try {
      const channel = await (await guild()).channels.fetch(t.channel_id);
      if (channel) await channel.delete(`Ticket #${id} archivé dans Clank`);
      store.db
        .prepare("UPDATE tickets SET channel_deleted=1 WHERE id=?")
        .run(id);
      store.audit("Clank", `ticket.channel_deleted:${id}`);
    } catch (error) {
      if (error.code === 10003) {
        store.db
          .prepare("UPDATE tickets SET channel_deleted=1 WHERE id=?")
          .run(id);
        return;
      }
      store.audit("Clank", `ticket.delete_failed:${id}`);
      console.warn(
        `[Clank] Ticket #${id} archivé ; suppression du salon à réessayer. Vérifiez Manage Channels.`,
      );
    }
  }
  async function closeTicket(id, actor, solutionId = null) {
    return locked(`ticket:${id}`, async () => {
      const t = store.ticket(id);
      if (!t || t.status !== "open")
        throw Error("Ticket déjà archivé ou introuvable.");
      if (solutionId !== null) {
        if (t.user_id !== actor)
          throw Error("Seul le demandeur peut valider cette solution.");
        if (!t.pending_solution_id || t.pending_solution_id !== solutionId)
          throw Error(
            "Cette solution n’est plus la solution proposée. Consultez la dernière réponse.",
          );
        const response = store.db
          .prepare(
            "SELECT * FROM responses WHERE id=? AND ticket_id=? AND kind=?",
          )
          .get(solutionId, id, "solution");
        if (!response) throw Error("Solution introuvable.");
      }
      // Durable archive first, Discord deletion second. A failed deletion can be retried safely.
      await snapshot(t);
      await archiveAttachments(store, id);
      store.db.exec("BEGIN IMMEDIATE");
      try {
        if (solutionId !== null)
          store.db
            .prepare("UPDATE responses SET accepted_at=? WHERE id=?")
            .run(new Date().toISOString(), solutionId);
        store.db
          .prepare(
            "UPDATE tickets SET status='closed',closed_at=?,channel_deleted=0 WHERE id=?",
          )
          .run(new Date().toISOString(), id);
        store.audit(
          actor,
          `${solutionId !== null ? "ticket.accept" : "ticket.close"}:${id}`,
        );
        store.db.exec("COMMIT");
      } catch (error) {
        store.db.exec("ROLLBACK");
        throw error;
      }
      await deleteArchivedChannel(id);
      await sendPortal(store.ticket(id), true);
      return {
        archived: true,
        channelDeleted: Boolean(store.ticket(id).channel_deleted),
        dmSent: Boolean(store.ticket(id).dm_sent),
      };
    });
  }
  async function claimTicket(id, actor) {
    return locked(`ticket:${id}`, async () => {
      const t = store.ticket(id);
      if (!t || t.status !== "open")
        throw Error("Ticket archivé ou introuvable.");
      if (t.assignee && t.assignee !== actor)
        throw Error(
          "Ce ticket est déjà pris en charge par une autre personne.",
        );
      const channel = await (await guild()).channels.fetch(t.channel_id);
      const m = await channel.send({
        content: `Ticket pris en charge par <@${actor}>. Utilisez le bouton Répondre pour envoyer une tâche, une question ou une solution.`,
        components: [ticketControls(id)],
        allowedMentions: { parse: [] },
      });
      store.saveMessage(id, m);
      store.db
        .prepare("UPDATE tickets SET assignee=? WHERE id=?")
        .run(actor, id);
      store.audit(actor, `ticket.claim:${id}`);
    });
  }
  async function replyTicket(id, content, actor, kind = "question") {
    return locked(`ticket:${id}`, async () => {
      const t = store.ticket(id);
      if (!t || t.status !== "open")
        throw Error("Ticket archivé ou introuvable.");
      if (t.assignee !== actor)
        throw Error(
          "Prenez ce ticket en charge avant de répondre. Seul son responsable peut utiliser le formulaire.",
        );
      if (!Object.hasOwn(responseTypes, kind))
        throw Error("Choisissez Tâche, Question ou Solution.");
      if (
        typeof content !== "string" ||
        !content.trim() ||
        content.length > 4000
      )
        throw Error("Réponse requise, 4000 caractères maximum.");
      const responseId = Number(
        store.db
          .prepare(
            "INSERT INTO responses(ticket_id,kind,actor,content,created_at) VALUES(?,?,?,?,?)",
          )
          .run(id, kind, actor, content.trim(), new Date().toISOString())
          .lastInsertRowid,
      );
      const channel = await (await guild()).channels.fetch(t.channel_id);
      let message;
      try {
        message = await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${responseTypes[kind]} · Ticket #${id}`)
              .setDescription(content.trim())
              .setColor(
                kind === "solution"
                  ? 0xc0f57c
                  : kind === "task"
                    ? 0x83b8ff
                    : 0xd8b4fe,
              )
              .setFooter({ text: `Support · ${actor}` }),
          ],
          components:
            kind === "solution"
              ? [
                  new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                      .setCustomId(`ticket:accept:${id}:${responseId}`)
                      .setLabel("Valider la solution et archiver")
                      .setStyle(ButtonStyle.Success),
                  ),
                ]
              : [],
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        store.db.prepare("DELETE FROM responses WHERE id=?").run(responseId);
        throw error;
      }
      store.saveMessage(id, message);
      store.db
        .prepare("UPDATE responses SET message_id=? WHERE id=?")
        .run(message.id, responseId);
      store.db
        .prepare("UPDATE tickets SET pending_solution_id=? WHERE id=?")
        .run(kind === "solution" ? responseId : null, id);
      store.audit(actor, `ticket.reply_${kind}:${id}`);
      return { responseId };
    });
  }
  return {
    closeTicket,
    claimTicket,
    replyTicket,
    sendPortal,
    deleteArchivedChannel,
  };
}
