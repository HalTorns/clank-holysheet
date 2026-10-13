const explanations = {
  CLANK_GUILD_ID:
    "DISCORD_GUILD_ID doit contenir uniquement l’identifiant numérique du serveur, sans guillemets ni URL.",
  CLANK_GUILD_NOT_JOINED:
    "Clank n’est pas membre du serveur indiqué par DISCORD_GUILD_ID. Invitez le bot sur ce serveur ou corrigez cet identifiant.",
  10004:
    "Serveur Discord introuvable. Vérifiez DISCORD_GUILD_ID et l’invitation du bot.",
  50001:
    "Accès au serveur refusé par Discord. Vérifiez que ce bot est invité sur le serveur configuré.",
  50013:
    "Permissions Discord insuffisantes pour cette opération. Vérifiez les droits du bot et sa position dans la hiérarchie des rôles.",
  50035:
    "Discord a refusé les paramètres envoyés. Vérifiez la configuration de l’application et la commande.",
  10007: "Ce compte utilisateur n’est pas membre du serveur configuré.",
  TokenInvalid:
    "Le token du bot est invalide. Remplacez DISCORD_BOT_TOKEN dans Coolify.",
  DisallowedIntents:
    "Activez Message Content Intent dans Developer Portal → Bot, puis redémarrez Clank.",
  ENOTFOUND:
    "Le serveur d’hébergement ne peut pas résoudre Discord. Vérifiez son DNS.",
  ETIMEDOUT:
    "La connexion à Discord a expiré. Vérifiez le réseau du serveur d’hébergement.",
};
export function discordErrorInfo(error) {
  const raw = error?.code;
  const code = Object.hasOwn(explanations, raw) ? String(raw) : "INCONNUE";
  return {
    code,
    message:
      explanations[code] ||
      "Discord ou la base locale est indisponible. Vérifiez la connexion et le stockage du conteneur.",
  };
}
export function logDiscordError(stage, error) {
  const detail = discordErrorInfo(error);
  // Never print the error object, request URL/body, token or OAuth credentials.
  console.error(`[Clank] ${stage} — code ${detail.code} : ${detail.message}`);
}
export async function configuredGuild(client, value) {
  const id = String(value || "").trim();
  if (!/^\d{17,20}$/.test(id))
    throw Object.assign(new Error(explanations.CLANK_GUILD_ID), {
      code: "CLANK_GUILD_ID",
    });
  if (client.isReady() && !client.guilds.cache.has(id))
    throw Object.assign(new Error(explanations.CLANK_GUILD_NOT_JOINED), {
      code: "CLANK_GUILD_NOT_JOINED",
    });
  return client.guilds.fetch(id);
}
