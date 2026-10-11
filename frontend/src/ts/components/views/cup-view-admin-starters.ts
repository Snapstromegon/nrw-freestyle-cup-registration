import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { errorMessage, PollController, unwrap } from "../../api";
import { client, type components } from "../../apiClient";
import { adminStyles } from "../../styles/admin";
import { iconStyles, resetStyles } from "../../styles/base";
import {
  type ActType,
  actTypeLabels,
  actTypeShort,
  type CheckInMap,
  checkInMap,
  checkInStats,
  countStarts,
  describeGroup,
  formatAge,
  formatDate,
  formatTime,
  isGroupActType,
  MIN_GROUP_SIZE,
  participantName,
} from "../../utils";

type Act = components["schemas"]["Act"];
type Category = components["schemas"]["Category"];
type Starter = components["schemas"]["Starter"];

/** One starter in one section of the starter table. */
interface Row {
  starter: Starter;
  /** The act this row is about; `null` for starters without such an act. */
  act: Act | null;
  /** The act type a row without act is about (e.g. a pair without partner). */
  actType: ActType | null;
  isReplacement: boolean;
  /** Why the row has no category. */
  note?: string;
}

interface Section {
  key: string;
  category: Category | null;
  rows: Row[];
}

type SortKey = "name" | "club" | "age";

const NO_CATEGORY = "none";

/** Single act types are split by gender in chips: EM / EW. */
const singleLabel = (starter: Starter) => (starter.single_male ? "EM" : "EW");

const compareText = (a: string, b: string) => a.localeCompare(b, "de");

/**
 * Why a group with `type_conflict` has no category: a rider is also in
 * another group of the same type.
 */
const conflictReason = (act: Act, acts: Act[]) => {
  const ids = new Set(act.participants.map((p) => p.id));
  const others = acts
    .filter(
      (other) =>
        other.id !== act.id &&
        other.act_type === act.act_type &&
        other.participants.some((p) => ids.has(p.id)),
    )
    .map((other) => `„${other.group_name ?? other.name}“`);
  return `FahrerIn auch in ${others.join(", ") || "einer anderen Gruppe"} – nur eine ${actTypeLabels[act.act_type]} je FahrerIn`;
};

@customElement("cup-view-admin-starters")
export default class CupViewAdminStarters extends LitElement {
  static override styles = [
    resetStyles,
    iconStyles,
    adminStyles,
    css`
      .head {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.125rem 1rem;
      }

      .chip.current {
        background: var(--cup-blue);
        border-color: var(--cup-blue);
        color: #fff;
      }

      .dense tbody tr.group-head > th .chip.current {
        font-weight: 600;
      }

      h2 {
        margin-top: 0.75rem;
      }

      .empty-categories {
        margin: 0.25rem 0;
      }

      .toolbar input[type="search"].inline {
        width: 18em;
      }

      /*
       * Narrow screens: tables scroll sideways on their own instead of the
       * page. Sticky headers then stick inside the table only.
       */
      @media (max-width: 1100px) {
        .table-wrap {
          overflow-x: auto;
          --admin-sticky-top: 0px;
        }
      }
    `,
  ];

  @state() private starters: Starter[] = [];
  @state() private acts: Act[] = [];
  @state() private categories: Category[] = [];
  @state() private checkIns: CheckInMap = new Map();
  @state() private loaded = false;
  @state() private error: string | null = null;
  /** Why the last poll failed; cleared by the next successful one. */
  @state() private pollError: string | null = null;
  @state() private search = "";
  /** "" (all), "type:<act type>", "cat:<category>" or `NO_CATEGORY`. */
  @state() private filter = "";
  @state() private onlyMissingCheckIn = false;
  @state() private sort: { key: SortKey; desc: boolean } = {
    key: "name",
    desc: false,
  };

  // Registers itself with the host; keeps the check-in column current. A
  // poll that hangs is aborted, so its failure shows up as "Abgleich gestört".
  readonly poll = new PollController(this, 10_000, (signal) =>
    this.refreshCheckIns(signal),
  );

  override connectedCallback() {
    super.connectedCallback?.();
    this.load();
  }

  private async load(signal?: AbortSignal) {
    try {
      const [starters, acts, categories] = await Promise.all([
        client.GET("/api/query/list_starters", { signal }),
        client.GET("/api/query/list_acts", { signal }),
        client.GET("/api/query/list_categories", { signal }),
      ]);
      this.starters = unwrap(starters);
      this.acts = unwrap(acts);
      this.categories = unwrap(categories);
      this.checkIns = checkInMap(
        this.starters.map((s) => ({
          starter_id: s.id,
          checked_in_at: s.checked_in_at,
        })),
      );
      this.loaded = true;
      this.error = null;
      this.pollError = null;
    } catch (error) {
      this.error = `Daten konnten nicht geladen werden: ${errorMessage(error)}`;
    }
  }

  private async refreshCheckIns(signal?: AbortSignal) {
    if (!this.loaded) {
      // The first load failed: retry it.
      return this.load(signal);
    }
    try {
      this.checkIns = checkInMap(
        unwrap(await client.GET("/api/query/list_check_ins", { signal })),
      );
      this.pollError = null;
    } catch (error) {
      this.pollError = errorMessage(error);
    }
  }

  // ---------- Derived data ----------

  private actsByStarter() {
    const map = new Map<string, Act[]>();
    for (const act of this.acts) {
      for (const p of act.participants) {
        map.set(p.id, [...(map.get(p.id) ?? []), act]);
      }
    }
    return map;
  }

  /** One section per category (in category order), then "Ohne Kategorie". */
  private sections(actsByStarter: Map<string, Act[]>): Section[] {
    const starterById = new Map(this.starters.map((s) => [s.id, s]));
    const rowsOf = (act: Act, note?: string): Row[] =>
      act.participants.flatMap((p) => {
        const starter = starterById.get(p.id);
        return starter
          ? [
              {
                starter,
                act,
                actType: act.act_type,
                isReplacement: p.is_replacement,
                note,
              },
            ]
          : [];
      });

    const sections: Section[] = this.categories.map((category) => ({
      key: category.name,
      category,
      rows: this.acts
        .filter((act) => act.category === category.name)
        .flatMap((act) => rowsOf(act)),
    }));

    const uncategorized: Row[] = this.acts
      .filter((act) => !act.category)
      .flatMap((act) => rowsOf(act, this.uncategorizedReason(act)));
    for (const starter of this.starters) {
      const acts = actsByStarter.get(starter.id) ?? [];
      if (starter.pair && !acts.some((act) => act.act_type === "pair")) {
        uncategorized.push({
          starter,
          act: null,
          actType: "pair",
          isReplacement: false,
          note: starter.partner_name
            ? `Paarpartner „${starter.partner_name}“ nicht zugeordnet`
            : "Paarpartner fehlt",
        });
      } else if (acts.length === 0) {
        uncategorized.push({
          starter,
          act: null,
          actType: null,
          isReplacement: false,
          note: "keine Starts",
        });
      }
    }
    sections.push({ key: NO_CATEGORY, category: null, rows: uncategorized });
    return sections;
  }

  /** Why an act didn't get a category. */
  private uncategorizedReason(act: Act) {
    if (act.type_conflict) {
      return conflictReason(act, this.acts);
    }
    const regular = act.participants.filter((p) => !p.is_replacement).length;
    if (isGroupActType(act.act_type) && regular < MIN_GROUP_SIZE) {
      return describeGroup(regular, act.participants.length - regular, null);
    }
    const label = actTypeLabels[act.act_type];
    if (!this.categories.some((c) => c.act_type === act.act_type)) {
      return `keine Kategorie für ${label} angelegt`;
    }
    return `keine passende Kategorie (${label}, Alter ${formatAge(act.max_age)})`;
  }

  private sectionVisible(section: Section) {
    if (!this.filter) {
      return true;
    }
    if (this.filter === NO_CATEGORY) {
      return section.category === null;
    }
    if (this.filter.startsWith("cat:")) {
      return section.category?.name === this.filter.slice(4);
    }
    // type:… — categories of that type, and the matching rows without one.
    return (
      section.category === null ||
      section.category.act_type === this.filter.slice(5)
    );
  }

  private rowVisible(row: Row) {
    if (
      this.filter.startsWith("type:") &&
      row.actType !== this.filter.slice(5)
    ) {
      return false;
    }
    if (this.onlyMissingCheckIn && this.checkIns.get(row.starter.id)) {
      return false;
    }
    const needle = this.search.trim().toLocaleLowerCase("de");
    if (!needle) {
      return true;
    }
    return [
      `${row.starter.firstname} ${row.starter.lastname}`,
      row.starter.club_name,
      row.act?.group_name ?? "",
    ].some((text) => text.toLocaleLowerCase("de").includes(needle));
  }

  private sortRows(rows: Row[]) {
    const { key, desc } = this.sort;
    const byName = (a: Row, b: Row) =>
      compareText(a.starter.lastname, b.starter.lastname) ||
      compareText(a.starter.firstname, b.starter.firstname);
    const compare = (a: Row, b: Row) => {
      switch (key) {
        case "name":
          return byName(a, b);
        case "club":
          return compareText(a.starter.club_name, b.starter.club_name);
        case "age":
          return a.starter.age_on_competition - b.starter.age_on_competition;
      }
    };
    return [...rows].sort(
      (a, b) => (desc ? -compare(a, b) : compare(a, b)) || byName(a, b),
    );
  }

  private get isFiltering() {
    return (
      this.filter !== "" || this.onlyMissingCheckIn || this.search.trim() !== ""
    );
  }

  // ---------- Render ----------

  override render() {
    if (!this.loaded) {
      return html`<div class="page-pad">
        <h1>Starter</h1>
        ${
          this.error
            ? html`<div class="error-banner">
              ${this.error}
              <button class="btn small" @click=${this.onReloadClick}>Erneut versuchen</button>
            </div>`
            : html`<p class="muted">Lädt…</p>`
        }
      </div>`;
    }
    const actsByStarter = this.actsByStarter();
    const sections = this.sections(actsByStarter);
    return html`<div class="page-pad">
      ${this.renderHead(sections)}
      ${
        this.error
          ? html`<div class="error-banner" role="alert">
            ${this.error}
            <button
              class="icon-btn"
              title="Schließen"
              aria-label="Schließen"
              @click=${this.dismissError}
            >
              close
            </button>
          </div>`
          : nothing
      }
      ${this.renderToolbar()} ${this.renderStarters(sections, actsByStarter)}
      ${this.renderGroups()}
    </div>`;
  }

  private renderHead(sections: Section[]) {
    const starters = this.starters;
    const clubs = new Set(starters.map((s) => s.club_id)).size;
    const groupRiders = (type: ActType) =>
      this.acts
        .filter((act) => act.act_type === type)
        .reduce((sum, act) => sum + act.participants.length, 0);
    const starts = starters.reduce((sum, s) => sum + countStarts(s), 0);
    const checkedIn = starters.filter((s) => this.checkIns.get(s.id)).length;
    const uncategorized =
      sections.find((s) => s.category === null)?.rows.length ?? 0;
    const groups = this.acts.filter((act) => isGroupActType(act.act_type));
    const incompleteGroups = groups.filter((act) => !act.category).length;

    return html`<div class="head">
      <h1>Starter</h1>
      <div class="kpis">
        <span class="kpi"><b>${starters.length}</b> Starter</span>
        <span class="kpi"><b>${clubs}</b> Vereine</span>
        <span class="kpi" title="Starts, Gruppen inklusive Ersatzfahrer"
          ><b>${starts}</b> Starts
          <span class="small"
            >(EM ${starters.filter((s) => s.single_male).length} · EW
            ${starters.filter((s) => s.single_female).length} · P
            ${starters.filter((s) => s.pair).length} · KG
            ${groupRiders("group_small")} · GG
            ${groupRiders("group_large")})</span
          ></span
        >
        <span class="kpi ${incompleteGroups ? "warn" : ""}"
          ><b>${groups.length}</b> Gruppen${
            incompleteGroups
              ? html` <span class="text-warn"
                  >(ohne Kategorie ${incompleteGroups})</span
                >`
              : nothing
          }</span
        >
        <span
          class="kpi ${checkedIn === starters.length ? "ok" : ""}"
          title="Eingecheckte Starter"
          >Eingecheckt <b>${checkedIn}/${starters.length}</b></span
        >
        ${
          uncategorized
            ? html`<span
              class="kpi warn"
              title="Einträge ohne Kategorie: unvollständige Gruppen, Alter außerhalb aller Kategorien, Paare ohne Partner, Starter ohne Starts"
              >ohne Kategorie <b>${uncategorized}</b></span
            >`
            : nothing
        }
      </div>
    </div>`;
  }

  private renderToolbar() {
    const types = [...new Set(this.categories.map((c) => c.act_type))];
    return html`<div class="toolbar">
      <input
        class="inline"
        type="search"
        placeholder="Suche: Name, Verein, Gruppe"
        aria-label="Suche"
        .value=${this.search}
        @input=${this.onSearchInput}
      />
      <select
        class="inline"
        aria-label="Kategorie"
        .value=${this.filter}
        @change=${this.onFilterChange}
      >
        <option value="">Alle Kategorien</option>
        <optgroup label="Kürart">
          ${repeat(
            types,
            (type) => type,
            (type) =>
              html`<option value="type:${type}" ?selected=${this.filter === `type:${type}`}>
                ${actTypeLabels[type]}
              </option>`,
          )}
        </optgroup>
        <optgroup label="Kategorie">
          ${repeat(
            this.categories,
            (c) => c.name,
            (c) =>
              html`<option value="cat:${c.name}" ?selected=${this.filter === `cat:${c.name}`}>
                ${c.name}${c.description ? ` – ${c.description}` : ""}
              </option>`,
          )}
          <option value=${NO_CATEGORY} ?selected=${this.filter === NO_CATEGORY}>
            Ohne Kategorie
          </option>
        </optgroup>
      </select>
      <button
        class="chip"
        aria-pressed=${this.onlyMissingCheckIn ? "true" : "false"}
        @click=${this.onMissingCheckInClick}
      >
        nicht eingecheckt
      </button>
      <span class="spacer"></span>
      ${
        this.pollError
          ? html`<span
              class="chip warn"
              title="Der Check-in-Stand wird alle 10 s abgeglichen; der letzte Abgleich ist fehlgeschlagen."
              >Abgleich gestört: ${this.pollError}</span
            >`
          : nothing
      }
      <button
        class="icon-btn"
        title="Aktualisieren"
        aria-label="Aktualisieren"
        @click=${this.onReloadClick}
      >
        refresh
      </button>
    </div>`;
  }

  private renderStarters(
    sections: Section[],
    actsByStarter: Map<string, Act[]>,
  ) {
    const visible = sections
      .filter((section) => this.sectionVisible(section))
      .map((section) => ({
        section,
        rows: this.sortRows(section.rows.filter((row) => this.rowVisible(row))),
      }))
      .filter(({ rows }) => rows.length > 0);
    // Empty categories only get one line together, not a group head each.
    const emptyNames = sections
      .filter((section) => section.category && section.rows.length === 0)
      .map((section) => section.key)
      .join(", ");
    const emptyLine =
      emptyNames && !this.isFiltering
        ? html`<p class="empty-categories small muted">
          Kategorien ohne Starter: ${emptyNames}
        </p>`
        : nothing;
    if (visible.length === 0) {
      return html`<p class="empty">Keine Starter für diesen Filter.</p>
        ${emptyLine}`;
    }
    return html`<div class="table-wrap">
      <table class="dense">
        <thead>
          <tr>
            <th class="num">#</th>
            ${this.renderSortHeader("name", "Name")}
            ${this.renderSortHeader("club", "Verein")}
            <th class="num">Geb.</th>
            ${this.renderSortHeader("age", "Alter", "num")}
            <th>Starts</th>
            <th>Partner / Gruppe</th>
            <th class="c" title="Eingecheckt">CI</th>
          </tr>
        </thead>
        ${repeat(
          visible,
          ({ section }) => section.key,
          ({ section, rows }) => html`<tbody>
            ${this.renderSectionHead(section, rows.length)}
            ${repeat(
              rows,
              (row) => `${row.starter.id}/${row.act?.id ?? row.actType}`,
              (row, i) => this.renderRow(row, i, actsByStarter),
            )}
          </tbody>`,
        )}
      </table>
    </div>
    ${emptyLine}`;
  }

  private renderSortHeader(key: SortKey, label: string, cls = "") {
    const active = this.sort.key === key;
    return html`<th
      class="sortable ${cls}"
      aria-sort=${active ? (this.sort.desc ? "descending" : "ascending") : "none"}
      title="Sortieren"
      data-key=${key}
      @click=${this.onSortClick}
    >
      ${label}
    </th>`;
  }

  private renderSectionHead(section: Section, visibleRows: number) {
    const all = section.rows;
    const acts = new Set(all.map((row) => row.act?.id ?? row.starter.id)).size;
    const checkedIn = all.filter((row) =>
      this.checkIns.get(row.starter.id),
    ).length;
    const category = section.category;
    const size =
      category && category.act_type !== "single"
        ? `${acts} ${
            isGroupActType(category.act_type)
              ? acts === 1
                ? "Gruppe"
                : "Gruppen"
              : acts === 1
                ? "Paar"
                : "Paare"
          } · ${all.length} Fahrer`
        : `${all.length} Starter`;
    return html`<tr class="group-head">
      <th colspan="8">
        ${
          category
            ? html`${category.name}
                <span class="muted"
                  >· ${category.description || actTypeLabels[category.act_type]}</span
                >`
            : html`<span class="text-warn">Ohne Kategorie</span>
                <span class="muted"
                  >· erscheinen nicht in Startliste und Zeitplan</span
                >`
        }
        <span class="muted"
          >· ${size} · CI ${checkedIn}/${all.length}${
            visibleRows !== all.length ? ` · ${visibleRows} Treffer` : ""
          }</span
        >
      </th>
    </tr>`;
  }

  private renderRow(row: Row, i: number, actsByStarter: Map<string, Act[]>) {
    const s = row.starter;
    const checkedInAt = this.checkIns.get(s.id);
    return html`<tr class=${row.note ? "warn" : ""}>
      <td class="num muted">${i + 1}</td>
      <td>${s.lastname}, ${s.firstname}</td>
      <td class="trunc" title=${s.club_name}>${s.club_name}</td>
      <td class="num">${formatDate(s.birthdate)}</td>
      <td class="num">${formatAge(s.age_on_competition)}</td>
      <td>${this.renderStarts(s, row.act, actsByStarter.get(s.id) ?? [])}</td>
      <td class="trunc">${this.renderPartner(row)}</td>
      <td class="c">
        <span
          class="ci ${checkedInAt ? "yes" : "no"}"
          title=${
            checkedInAt
              ? `eingecheckt um ${formatTime(checkedInAt)}`
              : "nicht eingecheckt"
          }
        ></span>
      </td>
    </tr>`;
  }

  /** EM/EW/P/KG/GG chips of all starts; the row's own start is highlighted. */
  private renderStarts(starter: Starter, current: Act | null, acts: Act[]) {
    const chips: {
      key: string;
      label: string;
      title: string;
      tone: string;
    }[] = [];
    const tone = (act: Act | undefined, problem: boolean) =>
      act && act === current ? "current" : problem ? "warn" : "";

    if (starter.single_male || starter.single_female) {
      const act = acts.find((a) => a.act_type === "single");
      chips.push({
        key: "single",
        label: singleLabel(starter),
        title: starter.single_male ? "Einzel männlich" : "Einzel weiblich",
        tone: tone(act, !act?.category),
      });
    }
    if (starter.pair) {
      const act = acts.find((a) => a.act_type === "pair");
      const partners = act?.participants.filter((p) => p.id !== starter.id);
      chips.push({
        key: "pair",
        label: act ? "P" : "P ⚠",
        title: partners?.length
          ? `Paar mit ${partners.map(participantName).join(", ")}`
          : "Paarpartner nicht zugeordnet",
        tone: tone(act, !act?.category),
      });
    }
    for (const act of acts.filter((a) => isGroupActType(a.act_type))) {
      const replacement = act.participants.find(
        (p) => p.id === starter.id,
      )?.is_replacement;
      chips.push({
        key: act.id,
        label: `${actTypeShort[act.act_type]}${replacement ? "·E" : ""}`,
        title: `${actTypeLabels[act.act_type]} „${act.group_name ?? ""}“${
          replacement ? " (Ersatz)" : ""
        }${
          act.category
            ? ""
            : act.type_conflict
              ? " – Doppelstart"
              : " – unvollständig"
        }`,
        tone: tone(act, !act.category),
      });
    }
    return html`<span class="chips">
      ${repeat(
        chips,
        (chip) => chip.key,
        (chip) =>
          html`<span class="chip ${chip.tone}" title=${chip.title}
            >${chip.label}</span
          >`,
      )}
    </span>`;
  }

  private renderPartner(row: Row) {
    const { act, starter } = row;
    if (!act) {
      return html`<span class="chip warn">⚠ ${row.note}</span>`;
    }
    if (isGroupActType(act.act_type)) {
      return html`<span title=${row.note ?? ""}
        >${act.group_name}${
          row.isReplacement
            ? html` <span class="chip muted">Ersatz</span>`
            : nothing
        }${row.note ? html` <span class="chip warn">⚠ ${row.note}</span>` : nothing}</span
      >`;
    }
    const others = act.participants.filter((p) => p.id !== starter.id);
    const names = others
      .map((p) =>
        p.club_id === starter.club_id
          ? participantName(p)
          : `${participantName(p)} (${p.club_name})`,
      )
      .join(", ");
    return html`${names}${
      row.note ? html` <span class="chip warn">⚠ ${row.note}</span>` : nothing
    }`;
  }

  private renderGroups() {
    // Filtered to singles or pairs: no groups to show.
    const filterType = this.filter.startsWith("type:")
      ? this.filter.slice(5)
      : this.categories.find((c) => `cat:${c.name}` === this.filter)?.act_type;
    if (filterType && !isGroupActType(filterType as ActType)) {
      return nothing;
    }
    const groups = this.acts
      .filter((act) => isGroupActType(act.act_type))
      .sort((a, b) => compareText(a.group_name ?? "", b.group_name ?? ""));
    const needle = this.search.trim().toLocaleLowerCase("de");
    const visible = groups.filter((act) => {
      if (this.filter === NO_CATEGORY && act.category) {
        return false;
      }
      if (
        this.filter.startsWith("type:") &&
        act.act_type !== this.filter.slice(5)
      ) {
        return false;
      }
      if (
        this.filter.startsWith("cat:") &&
        act.category !== this.filter.slice(4)
      ) {
        return false;
      }
      if (
        this.onlyMissingCheckIn &&
        checkInStats(act.participants, this.checkIns).missing.length === 0
      ) {
        return false;
      }
      return (
        !needle ||
        [
          act.group_name ?? "",
          ...act.participants.map(participantName),
          ...act.participants.map((p) => p.club_name),
        ].some((text) => text.toLocaleLowerCase("de").includes(needle))
      );
    });

    return html`<h2>
        Gruppen
        <span class="muted small"
          >${groups.length}${
            visible.length !== groups.length
              ? ` · ${visible.length} Treffer`
              : ""
          }</span
        >
      </h2>
      ${
        visible.length === 0
          ? html`<p class="empty">
            ${groups.length ? "Keine Gruppen für diesen Filter." : "Noch keine Gruppen angemeldet."}
          </p>`
          : html`<div class="table-wrap">
              <table class="dense">
                <thead>
                  <tr>
                    <th>Gruppe</th>
                    <th>Typ</th>
                    <th>Kategorie</th>
                    <th class="num">Fahrer</th>
                    <th>Vereine</th>
                    <th class="num" title="Alter des ältesten Fahrers (inkl. Ersatz)">
                      ältester
                    </th>
                    <th class="c">Musik</th>
                    <th class="c" title="Eingecheckt">CI</th>
                  </tr>
                </thead>
                <tbody>
                  ${repeat(
                    visible,
                    (act) => act.id,
                    (act) => this.renderGroupRow(act),
                  )}
                </tbody>
              </table>
            </div>`
      }`;
  }

  private renderGroupRow(act: Act) {
    const regular = act.participants.filter((p) => !p.is_replacement).length;
    const replacements = act.participants.length - regular;
    const clubs = [...new Set(act.participants.map((p) => p.club_name))]
      .sort(compareText)
      .join(", ");
    const members = act.participants
      .map(
        (p) =>
          `${participantName(p)} (${p.club_name})${p.is_replacement ? " – Ersatz" : ""}`,
      )
      .join("\n");
    const stats = checkInStats(act.participants, this.checkIns);
    const regularMissing = stats.missing.some((p) => !p.is_replacement);
    const ciTone =
      stats.total === 0
        ? "muted"
        : stats.missing.length === 0
          ? "ok"
          : regularMissing
            ? "bad"
            : "warn";
    return html`<tr class=${act.category ? "" : "warn"}>
      <td class="trunc" title=${members || "Keine Fahrer"}>
        <b>${act.group_name}</b>
      </td>
      <td>
        <span class="chip" title=${actTypeLabels[act.act_type]}
          >${actTypeShort[act.act_type]}</span
        >
      </td>
      <td>
        ${
          act.category
            ? act.category
            : act.type_conflict
              ? html`<span
                  class="chip warn"
                  title=${conflictReason(act, this.acts)}
                  >Doppelstart</span
                >`
              : html`<span
                  class="chip warn"
                  title=${describeGroup(regular, replacements, null)}
                  >unvollständig</span
                >`
        }
      </td>
      <td class="num">
        ${regular}${
          replacements
            ? html` <span class="muted">(+${replacements} Ersatz)</span>`
            : nothing
        }
      </td>
      <td class="trunc" title=${clubs}>${clubs}</td>
      <td class="num">${formatAge(act.max_age)}</td>
      <td class="c">
        ${
          !act.song_file
            ? html`<span class="chip bad">fehlt</span>`
            : act.song_checked
              ? html`<span class="chip ok" title=${act.song_file_name ?? ""}
                  >geprüft</span
                >`
              : html`<span class="chip warn" title=${act.song_file_name ?? ""}
                  >ungeprüft</span
                >`
        }
      </td>
      <td class="c">
        <span
          class="chip ${ciTone}"
          title=${
            stats.missingNames.length
              ? `Nicht eingecheckt: ${stats.missingNames.join(", ")}`
              : stats.total
                ? "Alle eingecheckt"
                : "Keine Fahrer"
          }
          >${stats.checkedIn}/${stats.total}</span
        >
      </td>
    </tr>`;
  }

  // ---------- Events ----------

  private dismissError() {
    this.error = null;
  }

  /** Not `@click=${this.load}`: the click event isn't an AbortSignal. */
  private onReloadClick() {
    this.load();
  }

  private onSearchInput(e: Event) {
    this.search = (e.currentTarget as HTMLInputElement).value;
  }

  private onFilterChange(e: Event) {
    this.filter = (e.currentTarget as HTMLSelectElement).value;
  }

  private onMissingCheckInClick() {
    this.onlyMissingCheckIn = !this.onlyMissingCheckIn;
  }

  private onSortClick(e: Event) {
    const key = (e.currentTarget as HTMLElement).dataset.key as SortKey;
    this.sort =
      this.sort.key === key
        ? { key, desc: !this.sort.desc }
        : { key, desc: false };
  }
}
