let me,
  csrf,
  view = "overview",
  selectedTicket = null,
  config,
  resources,
  poll;
const $ = (s) => document.querySelector(s);
const el = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};
function notify(message) {
  $("#notice").textContent = message;
  $("#notice").hidden = false;
  setTimeout(() => ($("#notice").hidden = true), 6000);
}
async function api(path, method = "GET", body) {
  const r = await fetch(`/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Opération impossible.");
  return data;
}
function button(text, fn, kind = "") {
  const b = el("button", text, kind);
  b.type = "button";
  b.onclick = async () => {
    b.disabled = true;
    try {
      await fn();
    } catch (e) {
      notify(e.message);
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
function card(title) {
  const c = el("section", undefined, "card");
  if (title) c.append(el("h2", title));
  return c;
}
function label(text, input) {
  const l = el("label", text);
  l.append(input);
  return l;
}
function input(value = "", onChange, kind = "text") {
  const n = el(kind === "textarea" ? "textarea" : "input");
  if (kind !== "textarea") n.type = kind;
  n.value = value;
  n.oninput = () => onChange?.(n.value);
  return n;
}
function select(items, value, onChange) {
  const n = el("select");
  items.forEach((i) => {
    const o = el("option", i.name);
    o.value = i.id;
    n.append(o);
  });
  n.value = value;
  n.onchange = () => onChange(n.value);
  return n;
}
function table(headers, rows) {
  const wrapper = el("div", undefined, "table-wrap"),
    t = el("table"),
    head = el("tr");
  headers.forEach((h) => head.append(el("th", h)));
  const thead = el("thead");
  thead.append(head);
  t.append(thead);
  const body = el("tbody");
  rows.forEach((cells) => {
    const tr = el("tr");
    cells.forEach((value) => {
      const td = el("td");
      if (value instanceof Node) td.append(value);
      else td.textContent = value;
      tr.append(td);
    });
    body.append(tr);
  });
  t.append(body);
  wrapper.append(t);
  return wrapper;
}
const date = (s) => new Date(s).toLocaleString("fr-FR");
async function render() {
  clearInterval(poll);
  $("#content").replaceChildren();
  const titles = {
    overview: "Vue d’ensemble",
    tickets: "Support & tickets",
    projects: "Les projets",
    settings: "Configuration",
    audit: "Journal d’activité",
  };
  $("#heading").textContent = titles[view];
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  try {
    if (view === "overview") await overview();
    if (view === "tickets") await tickets();
    if (view === "projects") await projects();
    if (view === "settings") await settings();
    if (view === "audit") await audit();
  } catch (e) {
    $("#content").append(el("p", e.message, "error"));
  }
}
async function overview() {
  const [ts, ps] = await Promise.all([
    me.support ? api("/tickets") : [],
    me.team ? api("/projects") : [],
  ]);
  const grid = el("div", undefined, "grid");
  for (const [name, count] of [
    ["Tickets ouverts", ts.filter((t) => t.status === "open").length],
    ["Projets actifs", ps.filter((p) => p.status === "active").length],
    ["Tickets archivés", ts.filter((t) => t.status === "closed").length],
  ]) {
    const c = card();
    c.append(el("p", name, "muted"), el("div", String(count), "stat"));
    grid.append(c);
  }
  $("#content").append(grid);
  const c = card("Un espace, du cadrage à la résolution");
  c.append(
    el(
      "p",
      "Créez les espaces projet de l’équipe, répondez aux tickets et retrouvez les décisions. Les conversations de support restent privées.",
    ),
  );
  if (me.admin)
    c.append(
      button("Configurer Holysheet →", () => {
        view = "settings";
        return render();
      }),
    );
  $("#content").append(c);
}
async function tickets() {
  if (selectedTicket) return ticketDetail();
  const ts = await api("/tickets"),
    c = card("La file de support");
  c.append(
    table(
      ["Ticket", "Thème", "État", "Responsable", "Créé le", ""],
      ts.map((t) => [
        `#${t.id} · ${t.title}`,
        t.theme,
        t.status === "open" ? "Ouvert" : "Archivé",
        t.assignee || "Non attribué",
        date(t.created_at),
        button(
          "Ouvrir →",
          () => {
            selectedTicket = t.id;
            return render();
          },
          "secondary",
        ),
      ]),
    ),
  );
  if (!ts.length)
    c.append(
      el(
        "p",
        "Aucun ticket pour le moment. Publiez le panneau dans Discord pour recevoir les premières demandes.",
        "empty",
      ),
    );
  $("#content").append(c);
}
async function ticketDetail() {
  const { ticket: t, messages } = await api(`/tickets/${selectedTicket}`);
  const tools = el("div", undefined, "toolbar");
  tools.append(
    button(
      "← Tous les tickets",
      () => {
        selectedTicket = null;
        return render();
      },
      "secondary",
    ),
  );
  if (t.status === "open") {
    tools.append(
      button("Prendre en charge", async () => {
        await api(`/tickets/${t.id}/claim`, "POST", {});
        await render();
      }),
    );
    tools.append(
      button(
        "Fermer et archiver",
        async () => {
          if (!confirm("Fermer ce ticket et conserver son archive ?")) return;
          await api(`/tickets/${t.id}/close`, "POST", {});
          await render();
        },
        "secondary",
      ),
    );
  } else {
    const a = el("a", "Télécharger l’archive JSON");
    a.href = `/api/tickets/${t.id}/archive`;
    tools.append(a);
  }
  $("#content").append(tools);
  const c = card(`#${t.id} · ${t.title}`);
  c.append(
    el(
      "p",
      `${t.theme} · ${t.status === "open" ? "Ouvert" : "Archivé"} · Demandeur ${t.user_id}`,
      "muted",
    ),
  );
  const answers = JSON.parse(t.answers),
    details = el("details");
  details.append(el("summary", "Formulaire de la demande"));
  Object.entries(answers).forEach(([k, v]) =>
    details.append(el("p", `${k} : ${v}`)),
  );
  c.append(details);
  const log = el("div");
  function showMessages(ms) {
    log.replaceChildren();
    ms.forEach((m) => {
      const d = el("article", undefined, "message");
      d.append(
        el("strong", m.author),
        el(
          "small",
          ` · ${date(m.created_at)}${m.deleted ? " · supprimé dans Discord" : ""}`,
        ),
        el("p", m.content),
      );
      JSON.parse(m.attachments).forEach((a) => {
        const link = el("a", a.name || "Pièce jointe");
        const url = new URL(a.url);
        if (url.protocol === "https:") {
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          d.append(link);
        }
      });
      log.append(d);
    });
  }
  showMessages(messages);
  c.append(log);
  $("#content").append(c);
  if (t.status === "open") {
    const reply = card("Répondre depuis le dashboard"),
      text = input("", null, "textarea");
    text.maxLength = 1800;
    reply.append(
      label("Votre réponse", text),
      button("Envoyer sur Discord ↗", async () => {
        await api(`/tickets/${t.id}/reply`, "POST", { content: text.value });
        await render();
      }),
    );
    $("#content").append(reply);
    poll = setInterval(async () => {
      try {
        const fresh = await api(`/tickets/${t.id}`);
        if (fresh.ticket.status === "closed") return render();
        showMessages(fresh.messages);
      } catch {}
    }, 5000);
  }
}
async function projects() {
  const ps = await api("/projects"),
    tools = card("Un nouveau projet ?"),
    name = input();
  name.placeholder = "Ex. Refonte API";
  name.maxLength = 80;
  tools.append(
    label("Nom du projet", name),
    button("Créer le projet", async () => {
      await api("/projects", "POST", { name: name.value });
      notify("Projet créé dans Discord.");
      await render();
    }),
  );
  $("#content").append(tools);
  const c = card("Espaces de l’équipe");
  c.append(
    table(
      ["ID", "Projet", "Responsable", "État", "Actions"],
      ps
        .filter((p) => p.status !== "deleted")
        .map((p) => {
          const actions = el("div", undefined, "toolbar");
          if (p.owner_id === me.id || me.admin) {
            actions.append(
              button(
                "Renommer",
                async () => {
                  const name = prompt("Nouveau nom", p.name);
                  if (name) {
                    await api(`/projects/${p.id}/rename`, "POST", { name });
                    await render();
                  }
                },
                "secondary",
              ),
            );
            if (p.status === "active")
              actions.append(
                button(
                  "Archiver",
                  async () => {
                    await api(`/projects/${p.id}/archive`, "POST", {});
                    await render();
                  },
                  "secondary",
                ),
              );
            actions.append(
              button(
                "Supprimer",
                async () => {
                  if (
                    prompt(
                      `Suppression définitive de ${p.name}. Tapez SUPPRIMER pour confirmer.`,
                    ) !== "SUPPRIMER"
                  )
                    return;
                  await api(`/projects/${p.id}/delete`, "POST", {
                    confirm: true,
                  });
                  await render();
                },
                "danger",
              ),
            );
          }
          return [
            p.id,
            p.name,
            p.owner_id,
            p.status === "active" ? "Actif" : "Archivé",
            actions,
          ];
        }),
    ),
  );
  if (!ps.length) c.append(el("p", "Le premier projet commence ici.", "empty"));
  $("#content").append(c);
}
async function settings() {
  [config, resources] = await Promise.all([api("/config"), api("/resources")]);
  const actions = el("div", undefined, "toolbar");
  actions.append(
    button("Enregistrer", async () => {
      await api("/config", "PUT", config);
      notify(
        "Configuration enregistrée. Republiez le panneau si ses thèmes ont changé.",
      );
    }),
    button(
      "Publier / actualiser le panneau",
      async () => {
        await api("/panel", "POST", {});
        notify("Panneau publié sur Discord.");
      },
      "secondary",
    ),
    button(
      "Installer les espaces Holysheet",
      async () => {
        if (
          !confirm(
            "Créer les rôles et espaces Holysheet manquants à côté de l’existant ?",
          )
        )
          return;
        await api("/setup", "POST", {});
        notify("Espaces créés. Attribuez les rôles aux membres dans Discord.");
        await render();
      },
      "secondary",
    ),
  );
  $("#content").append(actions);
  const roles = card("Rôles et destinations"),
    row = el("div", undefined, "row");
  for (const [key, title] of [
    ["teamRoleId", "Équipe"],
    ["supportRoleId", "Support"],
    ["adminRoleId", "Admin"],
  ])
    row.append(
      label(
        title,
        select(
          [{ id: "", name: "Choisir un rôle" }, ...resources.roles],
          config[key],
          (v) => (config[key] = v),
        ),
      ),
    );
  for (const [key, title, type] of [
    ["panelChannelId", "Salon du panneau", 0],
    ["ticketCategoryId", "Catégorie des tickets", 4],
    ["archiveChannelId", "Salon des archives", 0],
  ])
    row.append(
      label(
        title,
        select(
          [
            { id: "", name: "Choisir une destination" },
            ...resources.channels.filter((c) => c.type === type),
          ],
          config[key],
          (v) => (config[key] = v),
        ),
      ),
    );
  roles.append(
    row,
    el(
      "p",
      "Les rôles servent à l’accès aux espaces Holysheet. Attribuez-les aux personnes concernées depuis Discord. Le rôle Admin Clank n’accorde pas la permission Administrateur Discord.",
      "muted",
    ),
  );
  $("#content").append(roles);
  const panel = card("Panneau de support");
  panel.append(
    label(
      "Titre",
      input(config.panelTitle, (v) => (config.panelTitle = v)),
    ),
    label(
      "Message",
      input(
        config.panelDescription,
        (v) => (config.panelDescription = v),
        "textarea",
      ),
    ),
  );
  $("#content").append(panel);
  const themes = card("Thèmes et catégories");
  function drawThemes() {
    list.replaceChildren();
    config.themes.forEach((t, i) => {
      const row = el("div", undefined, "editable");
      row.append(
        label(
          "Thème",
          input(t.name, (v) => (t.name = v)),
        ),
        label(
          "Destination",
          select(
            [
              { id: "", name: "Catégorie par défaut" },
              ...resources.channels.filter((c) => c.type === 4),
            ],
            t.categoryId,
            (v) => (t.categoryId = v),
          ),
        ),
        button(
          "Retirer",
          () => {
            config.themes.splice(i, 1);
            drawThemes();
          },
          "secondary",
        ),
      );
      list.append(row);
    });
  }
  const list = el("div");
  drawThemes();
  themes.append(
    list,
    button(
      "+ Ajouter un thème",
      () => {
        if (config.themes.length >= 25) throw Error("25 thèmes maximum.");
        config.themes.push({
          id: crypto.randomUUID().slice(0, 8),
          name: "Nouveau thème",
          categoryId: "",
        });
        drawThemes();
      },
      "secondary",
    ),
  );
  $("#content").append(themes);
  const fields = card("Formulaire des tickets");
  fields.append(
    el(
      "p",
      "Le thème est choisi avant le formulaire. Jusqu’à cinq champs texte ; titre et description sont obligatoires.",
      "muted",
    ),
  );
  const fl = el("div");
  function drawFields() {
    fl.replaceChildren();
    config.fields.forEach((f, i) => {
      const r = el("div", undefined, "field-row"),
        fixed = ["title", "description"].includes(f.id),
        check = input("", null, "checkbox");
      check.checked = f.required;
      check.disabled = fixed;
      check.onchange = () => (f.required = check.checked);
      r.append(
        label(
          "Libellé",
          input(f.label, (v) => (f.label = v)),
        ),
        label(
          "Format",
          select(
            [
              { id: "short", name: "Texte court" },
              { id: "paragraph", name: "Texte long" },
            ],
            f.style,
            (v) => (f.style = v),
          ),
        ),
        label("Obligatoire", check),
      );
      if (!fixed)
        r.append(
          button(
            "Retirer ce champ",
            () => {
              config.fields.splice(i, 1);
              drawFields();
            },
            "secondary",
          ),
        );
      fl.append(r);
    });
  }
  drawFields();
  fields.append(
    fl,
    button(
      "+ Ajouter un champ",
      () => {
        if (config.fields.length >= 5)
          throw Error("Discord accepte cinq champs maximum.");
        config.fields.push({
          id: crypto.randomUUID().slice(0, 8),
          label: "Nouveau champ",
          required: false,
          style: "short",
        });
        drawFields();
      },
      "secondary",
    ),
  );
  $("#content").append(fields);
  const template = card("Template des futurs projets");
  template.append(
    el(
      "p",
      "Toute l’équipe peut participer. Le créateur peut gérer et supprimer son projet. Les modifications du template s’appliquent aux nouveaux projets.",
      "muted",
    ),
  );
  const pl = el("div");
  function drawProjects() {
    pl.replaceChildren();
    config.projectChannels.forEach((p, i) => {
      const r = el("div", undefined, "field-row");
      r.append(
        label(
          "Nom du salon",
          input(p.name, (v) => (p.name = v)),
        ),
        label(
          "Type",
          select(
            [
              { id: "text", name: "Texte" },
              { id: "voice", name: "Vocal" },
            ],
            p.type,
            (v) => (p.type = v),
          ),
        ),
        label(
          "Description",
          input(p.description, (v) => (p.description = v)),
        ),
        button(
          "Retirer",
          () => {
            config.projectChannels.splice(i, 1);
            drawProjects();
          },
          "secondary",
        ),
      );
      pl.append(r);
    });
  }
  drawProjects();
  template.append(
    pl,
    button(
      "+ Ajouter un salon",
      () => {
        config.projectChannels.push({
          name: "nouveau-salon",
          type: "text",
          description: "",
        });
        drawProjects();
      },
      "secondary",
    ),
  );
  $("#content").append(template);
}
async function audit() {
  const rows = await api("/audit"),
    c = card("Dernières opérations");
  c.append(
    table(
      ["Date", "Auteur Discord", "Action"],
      rows.map((r) => [date(r.created_at), r.actor, r.action]),
    ),
  );
  $("#content").append(c);
}
async function init() {
  try {
    const data = await api("/me");
    me = data.user;
    csrf = data.csrf;
    $("#login").hidden = true;
    $("#workspace").hidden = false;
    $("#username").textContent = me.name;
    const tabs = [
      ["overview", "Vue d’ensemble"],
      ...(me.support ? [["tickets", "Tickets"]] : []),
      ...(me.team ? [["projects", "Projets"]] : []),
      ...(me.admin
        ? [
            ["settings", "Configuration"],
            ["audit", "Activité"],
          ]
        : []),
    ];
    tabs.forEach(([key, title]) => {
      const b = button(title, () => {
        view = key;
        selectedTicket = null;
        return render();
      });
      b.dataset.view = key;
      $("#nav").append(b);
    });
    $("#logout").onclick = async () => {
      try {
        await api("/logout", "POST", {});
        location.reload();
      } catch (e) {
        notify(e.message);
      }
    };
    await render();
  } catch (e) {
    if (e.message !== "Connexion Discord requise.") notify(e.message);
  }
}
init();
