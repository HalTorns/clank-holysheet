const clone = (value) => structuredClone(value);
const normal = (value) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function suggestSettings(saved, resources) {
  const draft = clone(saved),
    proposed = [];
  const suggestions = [
    ["teamRoleId", resources.roles, "Holysheet · Équipe"],
    ["supportRoleId", resources.roles, "Holysheet · Support"],
    [
      "panelChannelId",
      resources.channels.filter((c) => c.type === 0),
      "ouvrir-un-ticket",
    ],
    [
      "ticketCategoryId",
      resources.channels.filter((c) => c.type === 4),
      "HOLYSHEET · SUPPORT",
    ],
  ];
  for (const [key, items, name] of suggestions) {
    if (draft[key]) continue;
    const matches = items.filter((item) => normal(item.name) === normal(name));
    if (matches.length === 1) {
      draft[key] = matches[0].id;
      proposed.push(key);
    }
  }
  return { draft, proposed };
}
export function ticketReadiness(config, resources) {
  const missing = [];
  if (!config.supportRoleId) missing.push("Choisir qui traite les tickets");
  if (!config.panelChannelId)
    missing.push("Choisir où afficher le bouton de création");
  if (!config.ticketCategoryId)
    missing.push("Choisir où ranger les tickets privés");
  if (!config.panelTitle?.trim()) missing.push("Donner un titre au panneau");
  if (!config.themes.length || config.themes.some((t) => !t.name.trim()))
    missing.push("Nommer les thèmes des tickets");
  if (config.fields.some((f) => !f.label.trim()))
    missing.push("Nommer les champs du formulaire");
  if (
    resources &&
    config.supportRoleId &&
    !resources.roles.some((r) => r.id === config.supportRoleId)
  )
    missing.push("Remplacer le rôle Support introuvable");
  if (
    resources &&
    config.panelChannelId &&
    !resources.channels.some(
      (r) => r.id === config.panelChannelId && r.type === 0,
    )
  )
    missing.push("Remplacer le salon de création introuvable");
  if (
    resources &&
    config.ticketCategoryId &&
    !resources.channels.some(
      (r) => r.id === config.ticketCategoryId && r.type === 4,
    )
  )
    missing.push("Remplacer la catégorie des tickets introuvable");
  return { ready: missing.length === 0, missing };
}
export function ticketConfigurationChanged(saved, draft) {
  return [
    "supportRoleId",
    "panelChannelId",
    "panelTitle",
    "panelDescription",
    "themes",
    "fields",
    "ticketCategoryId",
  ].some((key) => JSON.stringify(saved[key]) !== JSON.stringify(draft[key]));
}

export async function mountSettings({
  host,
  api,
  el,
  card,
  label,
  input,
  select,
  button,
  notify,
  onDirty,
}) {
  let [saved, resources] = await Promise.all([
    api("/config"),
    api("/resources"),
  ]);
  let { draft, proposed } = suggestSettings(saved, resources),
    section = "start",
    busy = false,
    warning = "",
    warningKind = 'publication',
    dirty = false;
  const shell = el("div", undefined, "settings-shell"),
    nav = el("div", undefined, "settings-tabs toolbar"),
    status = el("div", undefined, "setup-status"),
    body = el("fieldset", undefined, "settings-body"),
    savebar = el("div", undefined, "settings-savebar");
  const saveNote = el("span", undefined, "muted"),
    saveButton = button("Enregistrer et activer les tickets", save);
  body.setAttribute("aria-label", "Réglages de Clank");
  savebar.append(saveNote, saveButton);
  shell.append(nav, status, body, savebar);
  host.append(shell);
  function resourceName(key) {
    return (
      [...resources.roles, ...resources.channels].find(
        (r) => r.id === draft[key],
      )?.name || "Non choisi"
    );
  }
  function updateState() {
    dirty = JSON.stringify(draft) !== JSON.stringify(saved);
    onDirty(dirty);
    saveNote.textContent = dirty
      ? "Modifications non enregistrées"
      : warning
        ? "Publication à réessayer"
        : "Réglages enregistrés";
    const publish =
      section === "start" ||
      section === "tickets" ||
      ticketConfigurationChanged(saved, draft);
    saveButton.textContent = !publish
      ? "Enregistrer les réglages"
      : saved.panelMessageId
        ? "Enregistrer et actualiser le panneau"
        : "Enregistrer et activer les tickets";
    status.replaceChildren();
    const readiness = ticketReadiness(draft, resources);
    const title = warning
      ? (warningKind === 'validation' ? 'Les réglages n’ont pas pu être enregistrés' : "Panneau Discord à actualiser")
      : readiness.ready
        ? dirty
          ? "Vos réglages sont prêts à enregistrer"
          : saved.panelMessageId
            ? "Les tickets sont prêts"
            : "Prêt à activer les tickets"
        : "Quelques choix restent à faire";
    status.classList.toggle(
      "needs-attention",
      Boolean(warning || !readiness.ready),
    );
    status.append(el("strong", title));
    if (warning) status.append(el("p", warning));
    else if (!readiness.ready) {
      const list = el("ul");
      readiness.missing.forEach((item) => list.append(el("li", item)));
      status.append(list);
    } else
      status.append(
        el(
          "p",
          `${resourceName("supportRoleId")} répond aux demandes. Le panneau apparaît dans #${resourceName("panelChannelId")}.`,
        ),
      );
  }
  function change(fn) {
    fn();
    warning = "";
    updateState();
    drawPreview();
  }
  function textField(title, key, long = false) {
    const control = input(
      draft[key],
      (v) => change(() => (draft[key] = v)),
      long ? "textarea" : "text",
    );
    control.maxLength = key === "panelTitle" ? 256 : 4096;
    return label(title, control);
  }
  function choice(title, key, items) {
    return label(
      title,
      select([{ id: "", name: "Choisir…" }, ...items], draft[key], (v) =>
        change(() => (draft[key] = v)),
      ),
    );
  }
  const roleItems = () => resources.roles,
    channelItems = (type) => resources.channels.filter((c) => c.type === type);
  function note(text) {
    return el("p", text, "muted");
  }
  let previewHost = null;
  function drawPreview() {
    if (!previewHost) return;
    previewHost.replaceChildren();
    previewHost.append(el("p", "APERÇU POUR LE DEMANDEUR", "eyebrow"));
    const panel = el("div", undefined, "discord-preview");
    panel.append(
      el("strong", draft.panelTitle || "Titre du panneau"),
      el("p", draft.panelDescription),
    );
    const theme = select(
      draft.themes.map((t) => ({ id: t.id, name: t.name || "Thème sans nom" })),
      draft.themes[0]?.id,
      () => {},
    );
    theme.disabled = true;
    theme.setAttribute("aria-label", "Aperçu du choix de thème");
    panel.append(theme);
    previewHost.append(panel);
    const form = el("div", undefined, "preview-form");
    form.append(el("h3", "Puis, le formulaire du ticket"));
    draft.fields.forEach((f) => {
      const control = input(
        "",
        null,
        f.style === "paragraph" ? "textarea" : "text",
      );
      control.disabled = true;
      control.placeholder =
        f.style === "paragraph"
          ? "Une description de la demande…"
          : "Votre réponse…";
      form.append(
        label(
          `${f.label || "Champ sans nom"}${f.required ? " *" : ""}`,
          control,
        ),
      );
    });
    previewHost.append(
      form,
      note(
        "Les visiteurs voient leurs propres tickets. L’équipe Support peut les traiter. Cet aperçu ne crée aucun ticket.",
      ),
    );
  }
  function preview() {
    previewHost = card();
    previewHost.classList.add("settings-preview");
    drawPreview();
    return previewHost;
  }
  async function save() {
    if (busy) return;
    busy = true;
    body.disabled = true;
    nav.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const publish =
        section === "start" ||
        section === "tickets" ||
        ticketConfigurationChanged(saved, draft);
      const result = await api(
        `/config${publish ? "?publish=1" : ""}`,
        "PUT",
        draft,
      );
      draft.panelMessageId = result.panelMessageId ?? "";
      saved = clone(draft);
      proposed = [];
      warning = result.warning || "";
      warningKind = 'publication';
      updateState();
      notify(
        result.warning ||
          (result.panelPublished
            ? "Réglages enregistrés et panneau Discord actualisé."
            : "Réglages enregistrés."),
      );
    } catch(error) {
      warning=error.message;warningKind='validation';updateState();throw error;
    } finally {
      busy = false;
      body.disabled = false;
      nav.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  }
  function start() {
    const c = card("Trois choix pour commencer");
    c.append(
      note(
        "Choisissez les personnes qui travaillent avec Clank et le salon où les visiteurs ouvrent leurs tickets.",
      ),
    );
    if (proposed.length)
      c.append(
        note(
          "Des choix ont été proposés à partir de vos espaces Holysheet. Vérifiez-les avant d’enregistrer.",
        ),
      );
    c.append(
      choice("Qui travaille sur les projets ?", "teamRoleId", roleItems()),
      choice("Qui traite les tickets ?", "supportRoleId", roleItems()),
      choice(
        "Où afficher le bouton de création ?",
        "panelChannelId",
        channelItems(0),
      ),
    );
    if (!draft.ticketCategoryId)
      c.append(
        choice(
          "Où ranger les tickets privés ?",
          "ticketCategoryId",
          channelItems(4),
        ),
      );
    else
      c.append(
        note(
          `Les tickets privés sont rangés dans « ${resourceName("ticketCategoryId")} ». Ce choix peut être modifié dans Avancé.`,
        ),
      );
    c.append(
      note(
        "Attribuez les rôles choisis aux personnes concernées dans Discord.",
      ),
    );
    const layout = el("div", undefined, "settings-layout");
    layout.append(c, preview());
    body.append(layout);
    const help = el("details", undefined, "settings-extra");
    help.append(el("summary", "Je n’ai pas encore créé les espaces Holysheet"));
    help.append(
      note(
        "Clank peut créer les rôles et salons manquants. Les espaces existants sont conservés.",
      ),
      button(
        "Créer les espaces Holysheet",
        async () => {
          if (
            dirty &&
            !confirm(
              "Les modifications non enregistrées seront remplacées par les réglages de l’installation. Continuer ?",
            )
          )
            return;
          if (!confirm("Créer les espaces Holysheet manquants sur Discord ?"))
            return;
          await api("/setup", "POST", {});
          [saved, resources] = await Promise.all([
            api("/config"),
            api("/resources"),
          ]);
          ({ draft, proposed } = suggestSettings(saved, resources));
          warning = "";
          drawSection();
          notify(
            "Espaces prêts. Attribuez les rôles aux membres dans Discord.",
          );
        },
        "secondary",
      ),
    );
    body.append(help);
  }
  function tickets() {
    const layout = el("div", undefined, "settings-layout"),
      edit = el("div");
    const panel = card("Le message d’accueil");
    panel.append(
      textField("Titre affiché aux visiteurs", "panelTitle"),
      textField("Message d’accueil", "panelDescription", true),
    );
    edit.append(panel);
    const themes = card("Les sujets des demandes"),
      themeList = el("div");
    function drawThemes() {
      themeList.replaceChildren();
      draft.themes.forEach((theme, i) => {
        const r = el("div", undefined, "theme-editor"),
          line = el("div", undefined, "theme-line");
        line.append(
          label(
            "Nom du thème",
            input(theme.name, (v) => change(() => (theme.name = v))),
          ),
          button(
            "Retirer",
            () => {
              change(() => draft.themes.splice(i, 1));
              drawThemes();
            },
            "subtle",
          ),
        );
        r.append(line);
        const extra = el("details", undefined, "settings-extra");
        extra.open = Boolean(theme.categoryId);
        extra.append(el("summary", "Options de ce thème"));
        const check = input("", null, "checkbox");
        check.checked = Boolean(theme.categoryId);
        const destination = el("label");
        function drawDestination() {
          destination.replaceChildren();
          destination.hidden = !check.checked;
          if (check.checked)
            destination.append(
              document.createTextNode("Dans quelle catégorie ?"),
              select(
                [{ id: "", name: "Choisir une catégorie" }, ...channelItems(4)],
                theme.categoryId,
                (v) => change(() => (theme.categoryId = v)),
              ),
            );
        }
        check.onchange = () => {
          change(
            () =>
              (theme.categoryId = check.checked
                ? draft.ticketCategoryId || ""
                : ""),
          );
          drawDestination();
        };
        extra.append(
          label("Utiliser une catégorie différente", check),
          destination,
        );
        drawDestination();
        r.append(extra);
        themeList.append(r);
      });
    }
    drawThemes();
    themes.append(
      themeList,
      button(
        "+ Ajouter un thème",
        () => {
          if (draft.themes.length >= 25) throw Error("25 thèmes maximum.");
          change(() =>
            draft.themes.push({
              id: crypto.randomUUID().slice(0, 8),
              name: "Nouveau thème",
              categoryId: "",
            }),
          );
          drawThemes();
        },
        "secondary",
      ),
    );
    edit.append(themes);
    const fields = card("Les informations à demander"),
      fieldList = el("div");
    fields.append(
      note(
        "Le nom du ticket et sa description sont toujours demandés. Vous pouvez ajouter trois autres champs.",
      ),
    );
    function drawFields() {
      fieldList.replaceChildren();
      draft.fields.forEach((f, i) => {
        const r = el("div", undefined, "field-row");
        r.append(
          label(
            `Question ${i + 1}`,
            input(f.label, (v) => change(() => (f.label = v))),
          ),
        );
        const details = el("details", undefined, "settings-extra");
        details.append(
          el("summary", "Options de la question"),
          label(
            "Type de réponse",
            select(
              [
                { id: "short", name: "Réponse courte" },
                { id: "paragraph", name: "Réponse détaillée" },
              ],
              f.style,
              (v) => change(() => (f.style = v)),
            ),
          ),
        );
        const fixed = ["title", "description"].includes(f.id),
          check = input("", null, "checkbox");
        check.checked = f.required;
        check.disabled = fixed;
        check.onchange = () => change(() => (f.required = check.checked));
        details.append(label("Réponse obligatoire", check));
        r.append(details);
        if (!fixed)
          r.append(
            button(
              "Retirer cette question",
              () => {
                change(() => draft.fields.splice(i, 1));
                drawFields();
              },
              "subtle",
            ),
          );
        fieldList.append(r);
      });
    }
    drawFields();
    fields.append(
      fieldList,
      button(
        "+ Ajouter une question",
        () => {
          if (draft.fields.length >= 5) throw Error("Cinq questions maximum.");
          change(() =>
            draft.fields.push({
              id: crypto.randomUUID().slice(0, 8),
              label: "Nouvelle question",
              required: false,
              style: "short",
            }),
          );
          drawFields();
        },
        "secondary",
      ),
    );
    edit.append(fields);
    layout.append(edit, preview());
    body.append(layout);
  }
  function projects() {
    const c = card("Les salons de chaque nouveau projet");
    c.append(
      note(
        "Ces salons seront créés dans l’ordre ci-dessous. Toute l’équipe participe ; le créateur gère son projet.",
      ),
    );
    const list = el("div");
    function draw() {
      list.replaceChildren();
      draft.projectChannels.forEach((p, i) => {
        const r = el("div", undefined, "field-row"),
          top = el("div", undefined, "project-template-row");
        top.append(
          el("span", String(i + 1).padStart(2, "0"), "step-number"),
          label(
            "Nom du salon",
            input(p.name, (v) => change(() => (p.name = v))),
          ),
          label(
            "Type",
            select(
              [
                { id: "text", name: "Texte" },
                { id: "voice", name: "Vocal" },
              ],
              p.type,
              (v) => change(() => (p.type = v)),
            ),
          ),
        );
        r.append(top);
        const controls = el("div", undefined, "toolbar");
        const move = (delta) => {
          change(() => {
            const next = i + delta;
            [draft.projectChannels[i], draft.projectChannels[next]] = [
              draft.projectChannels[next],
              draft.projectChannels[i],
            ];
          });
          draw();
        };
        const up = button("Monter", () => move(-1), "subtle"),
          down = button("Descendre", () => move(1), "subtle");
        up.disabled = i === 0;
        down.disabled = i === draft.projectChannels.length - 1;
        controls.append(
          up,
          down,
          button(
            "Retirer",
            () => {
              change(() => draft.projectChannels.splice(i, 1));
              draw();
            },
            "subtle",
          ),
        );
        r.append(controls);
        const details = el("details", undefined, "settings-extra");
        details.append(
          el("summary", "Ajouter une description"),
          label(
            "Description du salon",
            input(p.description, (v) => change(() => (p.description = v))),
          ),
        );
        r.append(details);
        list.append(r);
      });
    }
    draw();
    c.append(
      list,
      button(
        "+ Ajouter un salon",
        () => {
          if (draft.projectChannels.length >= 20)
            throw Error("20 salons maximum.");
          change(() =>
            draft.projectChannels.push({
              name: "nouveau-salon",
              type: "text",
              description: "",
            }),
          );
          draw();
        },
        "secondary",
      ),
    );
    body.append(c);
  }
  function advanced() {
    const access = card("Accès et rangement");
    access.append(
      choice("Qui administre Clank ?", "adminRoleId", roleItems()),
      choice(
        "Où ranger les tickets privés ?",
        "ticketCategoryId",
        channelItems(4),
      ),
      note(
        "Les identifiants ADMIN_USER_IDS et les administrateurs Discord gardent aussi l’accès complet. Les archives sont conservées sur le dashboard.",
      ),
    );
    body.append(access);
    const maintenance = card("Maintenance");
    maintenance.append(
      note(
        "Vous pouvez réessayer la publication du panneau. Cette action utilise les derniers réglages enregistrés.",
      ),
      button(
        "Réessayer la publication",
        async () => {
          if (dirty)
            throw Error(
              "Enregistrez vos modifications avant de republier le panneau.",
            );
          await api("/panel", "POST", {});
          saved = await api("/config");
          draft = clone(saved);
          warning = "";
          drawSection();
          notify("Panneau actualisé.");
        },
        "secondary",
      ),
    );
    body.append(maintenance);
  }
  function drawSection() {
    previewHost = null;
    body.replaceChildren();
    nav.querySelectorAll("button").forEach((b) => {
      const active = b.dataset.section === section;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    ({ start, tickets, projects, advanced })[section]();
    updateState();
  }
  for (const [key, title] of [
    ["start", "Démarrage"],
    ["tickets", "Tickets"],
    ["projects", "Projets"],
    ["advanced", "Avancé"],
  ]) {
    const b = button(
      title,
      () => {
        section = key;
        drawSection();
      },
      "secondary",
    );
    b.dataset.section = key;
    nav.append(b);
  }
  drawSection();
}
