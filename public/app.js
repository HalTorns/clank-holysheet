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
    mine: "Mes tickets",
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
    if (view === "tickets" || view === "mine") await tickets();
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
function ticketState(t) {
  return t.status === "closed"
    ? "Archivé"
    : t.pending_solution_id
      ? "Solution à valider"
      : t.assignee
        ? "En cours"
        : "À prendre en charge";
}
async function tickets() {
  if (selectedTicket) return ticketDetail();
  const ts = await api(view === "mine" ? "/tickets?scope=mine" : "/tickets"),
    c = card(view === "mine" ? "Mes demandes" : "La file de support");
  c.append(
    el(
      "p",
      view === "mine"
        ? "Retrouvez vos demandes et leurs archives. Seuls vous et le Support pouvez consulter ces conversations."
        : "Prenez un ticket en charge, puis répondez par une tâche, une question ou une solution. Le demandeur valide la solution avant archivage.",
      "muted",
    ),
  );
  c.append(
    table(
      ["Ticket", "Thème", "État", "Responsable", "Créé le", ""],
      ts.map((t) => [
        `#${t.id} · ${t.title}`,
        t.theme,
        ticketState(t),
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
  if (!ts.length) c.append(el("p", "Aucun ticket pour le moment.", "empty"));
  $("#content").append(c);
}
async function ticketDetail() {
  const {
    ticket: t,
    messages,
    responses = [],
  } = await api(`/tickets/${selectedTicket}`);
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
  if (t.status === "open" && me.support && !t.assignee)
    tools.append(
      button("Prendre en charge", async () => {
        await api(`/tickets/${t.id}/claim`, "POST", {});
        await render();
      }),
    );
  if (t.status === "open" && me.admin)
    tools.append(
      button(
        "Clôture administrative",
        async () => {
          if (
            !confirm(
              "Archiver sans validation du demandeur et supprimer le salon Discord ?",
            )
          )
            return;
          await api(`/tickets/${t.id}/close`, "POST", { confirm: true });
          await render();
        },
        "secondary",
      ),
    );
  if (t.status === "closed") {
    const link = el("a", "Télécharger mon archive");
    link.href = `/api/tickets/${t.id}/archive`;
    tools.append(link);
    if (me.support && !t.channel_deleted)
      tools.append(
        button(
          "Réessayer la suppression du salon",
          async () => {
            await api(`/tickets/${t.id}/cleanup`, "POST", {});
            await render();
          },
          "secondary",
        ),
      );
  }
  $("#content").append(tools);
  const c = card(`#${t.id} · ${t.title}`);
  c.append(
    el(
      "p",
      `${t.theme} · ${ticketState(t)} · Responsable : ${t.assignee || "non attribué"}`,
      "muted",
    ),
  );
  if (t.status === "closed")
    c.append(
      el(
        "p",
        "Cette conversation est conservée dans Clank. Aucun salon Discord n’est nécessaire pour la consulter.",
        "muted",
      ),
    );
  if (me.support && t.status === "closed" && !t.dm_sent)
    c.append(
      el(
        "p",
        "Le message privé n’a pas pu être remis au demandeur. Il peut retrouver ce ticket en se connectant au dashboard → Mes tickets.",
        "muted",
      ),
    );
  const details = el("details");
  details.append(el("summary", "Formulaire de la demande"));
  Object.entries(JSON.parse(t.answers)).forEach(([k, v]) =>
    details.append(el("p", `${k} : ${v}`)),
  );
  c.append(details);
  const log = el("div");
  function showMessages(ms) {
    log.replaceChildren();
    ms.forEach((m) => {
      const d = el("article", undefined, "message"),
        response = responses.find((r) => r.message_id === m.id);
      d.append(
        el(
          "strong",
          response
            ? `${{ task: "Tâche", question: "Question", solution: "Solution" }[response.kind]} · Support`
            : m.author,
        ),
        el(
          "small",
          ` · ${date(m.created_at)}${m.deleted ? " · supprimé avant archivage" : ""}`,
        ),
        el("p", response ? response.content : m.content),
      );
      JSON.parse(m.attachments).forEach((a) => {
        try {
          const url = new URL(a.url, location.origin);
          if (
            url.protocol === "https:" ||
            (url.origin === location.origin &&
              url.pathname.startsWith("/api/tickets/"))
          ) {
            const link = el("a", a.name || "Pièce jointe");
            link.href = url.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            d.append(link);
          }
        } catch {}
      });
      log.append(d);
    });
  }
  showMessages(messages);
  c.append(log);
  $("#content").append(c);
  if (t.status === "open" && t.pending_solution_id && t.user_id === me.id) {
    const solution = responses.find((r) => r.id === t.pending_solution_id),
      panel = card("La solution résout-elle votre demande ?");
    if (solution) panel.append(el("p", solution.content));
    panel.append(
      el(
        "p",
        "En validant, vous archivez la conversation et le salon Discord est supprimé. Vous pourrez toujours lire votre archive dans Mes tickets.",
        "muted",
      ),
      button("Valider la solution et archiver", async () => {
        if (!confirm("Valider cette solution et archiver le ticket ?")) return;
        await api(`/tickets/${t.id}/accept`, "POST", {
          solutionId: t.pending_solution_id,
        });
        await render();
      }),
    );
    $("#content").append(panel);
  }
  if (t.status === "open" && me.support && t.assignee === me.id) {
    const reply = card("Répondre au demandeur"),
      text = input("", null, "textarea");
    text.maxLength = 4000;
    let kind = "question";
    reply.append(
      label(
        "Type de réponse",
        select(
          [
            { id: "task", name: "Tâche" },
            { id: "question", name: "Question" },
            { id: "solution", name: "Solution" },
          ],
          kind,
          (v) => (kind = v),
        ),
      ),
      label("Votre réponse", text),
      el(
        "p",
        "Une solution affiche un bouton de validation réservé au demandeur. Une tâche ou une question laisse le ticket ouvert.",
        "muted",
      ),
      button("Envoyer sur Discord ↗", async () => {
        await api(`/tickets/${t.id}/reply`, "POST", {
          content: text.value,
          kind,
        });
        await render();
      }),
    );
    $("#content").append(reply);
  }
  if (t.status === "open")
    poll = setInterval(async () => {
      try {
        const fresh = await api(`/tickets/${t.id}`);
        if (
          fresh.ticket.status !== t.status ||
          fresh.ticket.pending_solution_id !== t.pending_solution_id ||
          fresh.ticket.assignee !== t.assignee ||
          fresh.responses?.length !== responses.length
        )
          return render();
        showMessages(fresh.messages);
      } catch {}
    }, 5000);
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
let settingsSection = "tickets";
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
  const roles = card("Accès au dashboard"),
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
  const destinations = card("Destinations des tickets"),
    destinationsRow = el("div", undefined, "row");
  for (const [key, title, type] of [
    ["panelChannelId", "Salon du panneau", 0],
    ["ticketCategoryId", "Catégorie des tickets", 4],
  ])
    destinationsRow.append(
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
  destinations.append(
    destinationsRow,
    el(
      "p",
      "Les archives restent dans la base de Clank. Aucun salon d’archives Discord n’est utilisé.",
      "muted",
    ),
  );
  $("#content").append(destinations);
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
  const groups = {
    access: [roles],
    tickets: [destinations, panel, themes, fields],
    projects: [template],
    installation: [],
  };
  const help = card("Installation des espaces");
  help.append(
    el(
      "p",
      "Crée les espaces Holysheet manquants à côté de l’existant. Les rôles restent à attribuer dans Discord. Les anciens salons d’archives ne sont pas supprimés automatiquement.",
      "muted",
    ),
  );
  $("#content").append(help);
  groups.installation.push(help);
  const sections = el("div", undefined, "toolbar settings-tabs");
  const applySection = () => {
    Object.entries(groups).forEach(([key, cards]) =>
      cards.forEach((c) => (c.hidden = key !== settingsSection)),
    );
    sections
      .querySelectorAll("button")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.section === settingsSection),
      );
    actions.children[1].hidden = settingsSection !== "tickets";
    actions.children[2].hidden = settingsSection !== "installation";
  };
  for (const [key, title] of [
    ["tickets", "Tickets"],
    ["projects", "Templates projets"],
    ["access", "Accès"],
    ["installation", "Installation"],
  ]) {
    const b = button(
      title,
      () => {
        settingsSection = key;
        applySection();
      },
      "secondary",
    );
    b.dataset.section = key;
    sections.append(b);
  }
  $("#content").prepend(sections);
  applySection();
}
async function audit() {
  const rows = await api("/audit"),
    c = card("Dernières opérations");
  c.append(
    table(
      ["Date", "Auteur", "Action", "Détail"],
      rows.map((r) => [
        date(r.created_at),
        r.actorName || r.actor,
        r.title || r.action,
        r.detail || "",
      ]),
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
      ...(me.team || me.support ? [["overview", "Vue d’ensemble"]] : []),
      ["mine", "Mes tickets"],
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
    const params = new URLSearchParams(location.search);
    if (params.get("view") === "mine" || (!me.team && !me.support))
      view = "mine";
    if (params.get("ticket") && /^\d+$/.test(params.get("ticket"))) {
      view = "mine";
      selectedTicket = Number(params.get("ticket"));
    }
    if (data.discordWarning) notify(data.discordWarning);
    const badge = document.querySelector("header .badge");
    if (badge)
      badge.textContent = data.ready
        ? "● Discord connecté"
        : "● Archives disponibles";
    await render();
  } catch (e) {
    if (e.message !== "Connexion Discord requise.") notify(e.message);
  }
}
const loginLink = document.querySelector("#login .primary");
if (loginLink)
  loginLink.href = `/auth/login?next=${encodeURIComponent("/" + location.search)}`;
init();
