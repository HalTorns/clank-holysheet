import { logDiscordError } from "./discord-errors.js";

export async function persistConfiguration({
  store,
  bot,
  config,
  actor,
  publish = false,
}) {
  if (
    publish &&
    (!config.supportRoleId ||
      !config.panelChannelId ||
      !config.ticketCategoryId)
  ) {
    throw Error(
      "Choisissez qui traite les tickets, où afficher le bouton et où ranger les tickets privés avant de les activer.",
    );
  }
  store.saveConfig(config);
  store.audit(actor, "config.update");
  if (!publish)
    return {
      ok: true,
      saved: true,
      panelPublished: false,
      panelMessageId: config.panelMessageId,
    };
  try {
    await bot.publishPanel();
    store.audit(actor, "panel.publish");
    return {
      ok: true,
      saved: true,
      panelPublished: true,
      panelMessageId: store.config().panelMessageId,
    };
  } catch (error) {
    logDiscordError("Actualisation du panneau de tickets", error);
    store.audit(actor, "panel.publish_failed");
    return {
      ok: true,
      saved: true,
      panelPublished: false,
      warning:
        "Réglages enregistrés, mais le panneau Discord n’a pas pu être actualisé. Vérifiez les permissions du bot puis réessayez.",
      panelMessageId: store.config().panelMessageId,
    };
  }
}
