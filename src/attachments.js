import { mkdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function archiveAttachments(store, ticketId) {
  const directory = join(store.directory, "attachments");
  await mkdir(directory, { recursive: true });
  for (const message of store.messages(ticketId))
    for (const attachment of JSON.parse(message.attachments)) {
      const url = new URL(attachment.url);
      const id = attachment.id || url.pathname.split("/")[3];
      if (
        url.protocol !== "https:" ||
        !["cdn.discordapp.com", "media.discordapp.net"].includes(
          url.hostname,
        ) ||
        !/^\d{17,20}$/.test(id)
      )
        throw Error(
          "Une pièce jointe ne peut pas être archivée. Le salon est conservé.",
        );
      if (store.db.prepare("SELECT id FROM attachments WHERE id=?").get(id))
        continue;
      const filename = `${ticketId}-${id}`,
        path = join(directory, filename),
        temporary = path + ".part";
      try {
        const response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok || !response.body)
          throw Error("Téléchargement refusé.");
        await pipeline(
          Readable.fromWeb(response.body),
          createWriteStream(temporary, { flags: "w" }),
        );
        await rename(temporary, path);
        store.db
          .prepare(
            "INSERT OR IGNORE INTO attachments(id,ticket_id,name,filename) VALUES(?,?,?,?)",
          )
          .run(id, ticketId, attachment.name || "piece-jointe", filename);
      } catch {
        await rm(temporary, { force: true });
        throw Error(
          "Une pièce jointe ne peut pas être sauvegardée. Vérifiez le stockage et réessayez ; le salon est conservé.",
        );
      }
    }
}
