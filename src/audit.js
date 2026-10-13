const actions = {
  "panel.publish": "Panneau des tickets actualisé dans Discord",
  "panel.publish_failed":
    "Réglages enregistrés — publication du panneau à réessayer",
  "ticket.create": "Ticket ouvert par le demandeur",
  "server.setup": "Espaces Holysheet installés",
  "config.update": "Configuration enregistrée",
  "ticket.claim": "Ticket pris en charge",
  "ticket.close": "Ticket archivé par un administrateur",
  "ticket.accept": "Solution validée par le demandeur — ticket archivé",
  "ticket.reply_task": "Tâche envoyée",
  "ticket.reply_question": "Question envoyée",
  "ticket.reply_solution": "Solution proposée — en attente de validation",
  "ticket.channel_deleted": "Salon Discord supprimé après archivage",
  "ticket.delete_failed":
    "Archive conservée — suppression du salon à réessayer",
  "ticket.dm": "Lien Mes tickets envoyé en message privé",
  "ticket.dm_failed":
    "Message privé refusé — Mes tickets reste accessible sur le dashboard",
  "project.create": "Projet créé",
  "project.rename": "Projet renommé",
  "project.archive": "Projet archivé",
  "project.delete": "Projet supprimé",
};
export function describeAudit(row, store, client) {
  const [action, id] = row.action.split(":");
  const t =
    action.startsWith("ticket.") && id ? store.ticket(Number(id)) : null;
  const p =
    action.startsWith("project.") && id
      ? store.db
          .prepare("SELECT * FROM projects WHERE id=? OR category_id=?")
          .get(id, id)
      : null;
  return {
    ...row,
    title: actions[action] || row.action,
    detail: t
      ? `Ticket #${t.id} · ${t.title} · ${t.theme}`
      : p
        ? `Projet #${p.id} · ${p.name}`
        : "",
    actorName:
      row.actor === "Clank"
        ? "Clank (automatique)"
        : client?.users.cache.get(row.actor)?.globalName ||
          client?.users.cache.get(row.actor)?.username ||
          row.actor,
  };
}
