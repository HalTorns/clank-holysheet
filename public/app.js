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
let settingsDirty = false;
async function settings() {
  const { mountSettings } = await import("/settings.js");
  await mountSettings({
    host: $("#content"),
    api,
    el,
    card,
    label,
    input,
    select,
    button,
    notify,
    onDirty: (value) => (settingsDirty = value),
  });
}
function confirmDiscard(message) {
  return new Promise((resolve) => {
    const dialog = el("dialog", undefined, "unsaved-dialog");
    dialog.setAttribute("aria-labelledby", "unsaved-title");
    const title = el("h2", "Modifications non enregistrées");
    title.id = "unsaved-title";
    const finish = (answer) => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    const actions = el("div", undefined, "toolbar");
    const stay = button(
      "Rester sur la configuration",
      () => finish(false),
      "secondary",
    );
    actions.append(
      stay,
      button("Continuer sans enregistrer", () => finish(true)),
    );
    dialog.append(title, el("p", message), actions);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    stay.focus();
  });
}
async function navigate(next) {
  if (
    view === "settings" &&
    settingsDirty &&
    !(await confirmDiscard(
      "Vos modifications seront perdues si vous quittez cet écran.",
    ))
  )
    return;
  settingsDirty = false;
  view = next;
  selectedTicket = null;
  return render();
}
window.addEventListener("beforeunload", (event) => {
  if (settingsDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
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
      const b = button(title, () => navigate(key));
      b.dataset.view = key;
      $("#nav").append(b);
    });
    $("#logout").onclick = async () => {
      if (
        settingsDirty &&
        !(await confirmDiscard(
          "Vos modifications seront perdues si vous vous déconnectez.",
        ))
      )
        return;
      try {
        await api("/logout", "POST", {});
        settingsDirty = false;
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
