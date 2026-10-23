import { consume } from "@lit/context";
import { Task, TaskStatus } from "@lit/task";
import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { repeat } from "lit/directives/repeat.js";
import { errorMessage, PollController, unwrap } from "../../api";
import { client, type schemas } from "../../apiClient";
import { responsibleIsContact } from "../../club-data";
import {
  type SystemStatus,
  systemStatusContext,
} from "../../contexts/systemStatus";
import { type User as CurrentUser, userContext } from "../../contexts/user";
import { type PairCandidate, unconfirmedPairs } from "../../pairs";
import { ROLES, type Role, roleLock, roleNames, withRole } from "../../roles";
import type { PickerOption } from "../elements/cup-rider-picker";
import "../elements/cup-rider-picker.js";
import { linkPartners } from "../elements/club/club-actions";
import { adminStyles } from "../../styles/admin";
import { iconStyles, resetStyles } from "../../styles/base";
import {
  actClubNames,
  actParticipantsLabel,
  actSizeWarning,
  actTypeShort,
  type CheckInMap,
  checkInMap,
  type Competition,
  describeGroup,
  formatDate,
  formatDateTime,
  formatMoney,
  isGroupActType,
  MIN_GROUP_SIZE,
  participantName,
} from "../../utils";

type Act = schemas.Act;
type ClubOverview = schemas.ClubOverview;
type Starter = schemas.Starter;
type User = schemas.User;

interface DashboardData {
  clubs: ClubOverview[];
  users: User[];
  starters: Starter[];
  acts: Act[];
}

/** One line of the club table. */
interface ClubRow {
  club: ClubOverview;
  starters: Starter[];
  em: number;
  ew: number;
  p: number;
  kg: number;
  gg: number;
  /** Acts with a rider of the club, or groups it owns. */
  acts: Act[];
  music: number;
  checked: number;
  checkedIn: number;
  due: number;
  paid: number;
  open: number;
}

type SortKey =
  | "name"
  | "contact"
  | "starters"
  | "em"
  | "ew"
  | "p"
  | "kg"
  | "gg"
  | "acts"
  | "music"
  | "checked"
  | "checkedIn"
  | "due"
  | "paid"
  | "open";

interface Sort {
  key: SortKey;
  desc: boolean;
}

/** Text columns sort A–Z first, counts and amounts largest first. */
const textKeys = new Set<SortKey>(["name", "contact"]);
/** "x/y" columns sort by completeness, the least complete first. */
const ratioKeys = new Set<SortKey>(["music", "checked", "checkedIn"]);

const ratio = (part: number, total: number) => (total ? part / total : 1);

const sortValue = (row: ClubRow, key: SortKey): number | string => {
  switch (key) {
    case "name":
      return row.club.name;
    case "contact":
      return row.club.owner_name ?? "";
    case "starters":
      return row.starters.length;
    case "acts":
      return row.acts.length;
    case "music":
      return ratio(row.music, row.acts.length);
    case "checked":
      return ratio(row.checked, row.music);
    case "checkedIn":
      return ratio(row.checkedIn, row.starters.length);
    default:
      return row[key];
  }
};

/** Amounts below half a cent count as settled. */
const CENT = 0.005;

const regularCount = (act: Act) =>
  act.participants.filter((p) => !p.is_replacement).length;

/** "E Anna Muster (SSV Nümbrecht)" or "KG „Wirbelwind“ (A & B)". */
const actLabel = (act: Act) => {
  const who =
    isGroupActType(act.act_type) && act.group_name
      ? `„${act.group_name}“`
      : actParticipantsLabel(act) || act.name || "ohne Teilnehmer";
  const clubs = actClubNames(act);
  return `${actTypeShort[act.act_type]} ${who}${clubs.length ? ` (${clubs.join(", ")})` : ""}`;
};

const buildClubRows = (
  data: DashboardData,
  checkIns: CheckInMap | null,
): ClubRow[] => {
  const rows = new Map<string, ClubRow>(
    data.clubs.map((club) => [
      club.id,
      {
        club,
        starters: [],
        em: 0,
        ew: 0,
        p: 0,
        kg: 0,
        gg: 0,
        acts: [],
        music: 0,
        checked: 0,
        checkedIn: 0,
        due: club.amount_due?.total ?? 0,
        paid: club.payment ?? 0,
        open: 0,
      },
    ]),
  );
  for (const starter of data.starters) {
    const row = rows.get(starter.club_id);
    if (!row) {
      continue;
    }
    row.starters.push(starter);
    row.em += Number(starter.single_male);
    row.ew += Number(starter.single_female);
    row.p += Number(starter.pair);
    if (checkIns ? checkIns.get(starter.id) : starter.checked_in_at) {
      row.checkedIn += 1;
    }
  }
  for (const act of data.acts) {
    // A cross-club act counts for every club involved.
    const clubIds = new Set(act.participants.map((p) => p.club_id));
    if (act.owner_club_id) {
      clubIds.add(act.owner_club_id);
    }
    for (const clubId of clubIds) {
      const row = rows.get(clubId);
      if (!row) {
        continue;
      }
      row.acts.push(act);
      if (act.song_file) {
        row.music += 1;
        row.checked += Number(act.song_checked);
      }
    }
    if (isGroupActType(act.act_type)) {
      for (const participant of act.participants) {
        const row = rows.get(participant.club_id);
        if (row) {
          row[act.act_type === "group_small" ? "kg" : "gg"] += 1;
        }
      }
    }
  }
  for (const row of rows.values()) {
    row.open = row.due - row.paid;
  }
  return [...rows.values()];
};

/** Something an admin should look at, with the view to fix it in. */
interface Issue {
  key: string;
  tone: "warn" | "bad";
  label: string;
  href: string;
  view: string;
  items: string[];
}

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
  return `Konflikt – FahrerIn auch in ${others.join(", ") || "einer anderen Gruppe"}`;
};

const buildIssues = (
  data: DashboardData,
  rows: ClubRow[],
  competition: Competition | null | undefined,
): Issue[] => {
  const now = Date.now();
  const issues: Issue[] = [];

  const unresolved = data.starters.filter(
    (s) => s.partner_name && !s.resolved_partner_name,
  );
  issues.push({
    key: "partners",
    tone: "warn",
    label: "Partner nicht zugeordnet",
    href: "#paare",
    view: "Bestätigen",
    items: unresolved.map(
      (s) => `${participantName(s)} (${s.club_name}) → „${s.partner_name}“`,
    ),
  });

  issues.push({
    key: "category",
    tone: "bad",
    label: "Küren ohne Kategorie",
    href: "/admin-acts-overview",
    view: "Küren",
    items: data.acts
      .filter((act) => !act.category)
      .map((act) => {
        const regular = regularCount(act);
        const reason = act.type_conflict
          ? conflictReason(act, data.acts)
          : isGroupActType(act.act_type) && regular < MIN_GROUP_SIZE
            ? describeGroup(
                act.act_type,
                regular,
                act.participants.length - regular,
                null,
              )
            : "keine passende Kategorie";
        return `${actLabel(act)}: ${reason}`;
      }),
  });

  issues.push({
    key: "group-size",
    tone: "warn",
    label: "Gruppen mit unpassender Größe",
    href: "/admin-acts-overview",
    view: "Küren",
    items: data.acts.flatMap((act) => {
      const warning = act.category ? actSizeWarning(act) : null;
      return warning ? [`${actLabel(act)}: ${warning}`] : [];
    }),
  });

  const musicEnd = competition ? new Date(competition.music_upload_end) : null;
  const musicOver = !!musicEnd && musicEnd.getTime() < now;
  issues.push({
    key: "music",
    tone: musicOver ? "bad" : "warn",
    label: musicEnd
      ? `Küren ohne Musik (Upload ${musicOver ? "seit" : "bis"} ${formatDateTime(musicEnd)})`
      : "Küren ohne Musik",
    href: "/admin-acts-overview",
    view: "Küren",
    items: data.acts.filter((act) => !act.song_file).map(actLabel),
  });

  issues.push({
    key: "unchecked",
    tone: "warn",
    label: "Musik nicht geprüft",
    href: "/admin-acts-overview",
    view: "Küren",
    items: data.acts
      .filter((act) => act.song_file && !act.song_checked)
      .map(actLabel),
  });

  // Open amounts only matter once the payment deadline has passed (or
  // always, if there is none).
  const deadline = competition?.payment_deadline;
  const deadlineOver =
    !!deadline && new Date(`${deadline}T23:59:59`).getTime() < now;
  if (!deadline || deadlineOver) {
    issues.push({
      key: "payments",
      tone: deadline ? "bad" : "warn",
      label: deadline
        ? `Offene Beträge (Zahlungsfrist ${formatDate(deadline)} abgelaufen)`
        : "Offene Beträge",
      href: "/admin-payments",
      view: "Zahlungen",
      items: rows
        .filter((row) => row.open > CENT)
        .sort((a, b) => b.open - a.open)
        .map((row) => `${row.club.name}: ${formatMoney(row.open)}`),
    });
  }

  // Only with the jury registration: clubs have a `jury` obligation then.
  issues.push({
    key: "jury",
    tone: "warn",
    label: "Vereine unter der Jury-Pflicht",
    href: "/admin-judges",
    view: "Jury",
    items: data.clubs
      .filter((club) => club.jury && club.jury.missing > 0)
      .map(
        (club) =>
          `${club.name}: ${club.jury!.missing === 1 ? "1 Einsatz fehlt" : `${club.jury!.missing} Einsätze fehlen`} (${formatMoney(club.jury!.fee)})`,
      ),
  });

  return issues.filter((issue) => issue.items.length > 0);
};

/** "1 Verein" / "2 Vereine". */
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Money without cents when there are none ("435 €"), for the KPI strip. */
const shortMoney = (amount: number) =>
  Math.abs(amount - Math.round(amount)) < CENT
    ? `${Math.round(amount).toLocaleString("de-DE")}\u00a0€`
    : formatMoney(amount);

/** `0` in a light colour, so the non-zero counts stand out. */
const count = (n: number) => (n ? n : html`<span class="zero">0</span>`);

/**
 * "x/y"; incomplete values get `tone`, complete ones `doneClass`. `–` if
 * there is nothing to count.
 */
const fraction = (
  part: number,
  total: number,
  tone: string,
  doneClass = "",
) => {
  if (!total) {
    return html`<span class="zero">–</span>`;
  }
  return html`<span class=${part < total ? tone : doneClass}
    >${part}/${total}</span
  >`;
};

/** The open amount: red if owed, green if settled, a blue chip if overpaid. */
const openAmount = (open: number, due: number): TemplateResult => {
  if (open > CENT) {
    return html`<b class="text-bad">${formatMoney(open)}</b>`;
  }
  if (open < -CENT) {
    return html`<span class="chip info" title="überzahlt"
      >+${formatMoney(-open)}</span
    >`;
  }
  return due > 0
    ? html`<span class="text-ok">${formatMoney(0)}</span>`
    : html`<span class="zero">${formatMoney(0)}</span>`;
};

/**
 * The admin landing page: key figures, things to look at, every club with
 * its starts, music, check-in and payment state (linking to the club's
 * portal, `/?club=<id>`) and the users without a club.
 */
@customElement("cup-view-admin")
export default class CupViewAdmin extends LitElement {
  static override styles = [
    resetStyles,
    iconStyles,
    adminStyles,
    css`
      /* The top bar names the page; the KPI strip gets the whole line. */
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }

      .kpis {
        column-gap: 0.875rem;
      }

      a.kpi {
        text-decoration: none;
      }

      a.kpi:hover {
        text-decoration: underline;
      }

      .toolbar h2 {
        margin: 0 0.5rem 0 0;
      }

      .zero {
        color: color-mix(in srgb, var(--cup-muted) 55%, transparent);
      }

      td.contact .email {
        display: inline-block;
        max-width: 16em;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: bottom;
        color: var(--cup-muted);
      }

      /* One column per role in the users table. */
      th.role,
      td.role {
        text-align: center;
      }

      th.role {
        font-size: 0.8em;
      }

      /* The overpaid sum goes below the open sum, not next to it. */
      td.open-total .chip {
        display: table;
        margin-left: auto;
      }

      /*
       * Below 1280px the 16 columns only fit without the e-mail (it stays in
       * the contact's tooltip). Below 1024px they don't fit at all: the table
       * scrolls on its own (its headers then don't stick), not the page.
       */
      @media (max-width: 1279px) {
        td.contact .email {
          display: none;
        }
      }

      @media (max-width: 1023px) {
        .table-wrap {
          overflow-x: auto;
          --admin-sticky-top: 0px;
        }
      }

      /* Auffälligkeiten */
      .issues {
        list-style: none;
        padding: 0.125rem 0.5rem 0.25rem;
      }

      .issues summary {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 1px 0;
        cursor: pointer;
        list-style: none;
      }

      .issues summary::-webkit-details-marker {
        display: none;
      }

      .issues summary::before {
        content: "▸";
        color: var(--cup-muted);
        transition: transform 0.1s;
      }

      .issues details[open] > summary::before {
        transform: rotate(90deg);
      }

      .issues .label {
        font-weight: 600;
        white-space: nowrap;
      }

      .issues .preview {
        flex: 1 1 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--cup-muted);
      }

      .issues details[open] .preview {
        visibility: hidden;
      }

      .issues .items {
        columns: 22em;
        column-gap: 1.5rem;
        list-style: none;
        padding: 0 0 0.25rem 1.25rem;
      }

      .issues .items li {
        break-inside: avoid;
      }

      .ok-line {
        padding: 0.25rem 0.5rem;
      }
    `,
  ];

  @consume({ context: systemStatusContext, subscribe: true })
  systemStatus: SystemStatus | null = null;
  @consume({ context: userContext, subscribe: true })
  currentUser: CurrentUser | null = null;

  @state() sort: Sort = { key: "name", desc: false };
  @state() search = "";
  /** Check-in times, polled; `null` until the first load. */
  @state() checkIns: CheckInMap | null = null;
  @state() error: string | null = null;
  @query("#paare") pairsSection?: HTMLDetailsElement;

  /** Unconfirmed pairs: the partner chosen per rider, if not the suggested. */
  @state() pairChoice = new Map<string, string>();
  /** Riders whose pair is being confirmed. */
  @state() linking = new Set<string>();
  /** Users whose role update is in flight. */
  @state() updatingUserRoles = new Set<string>();

  /**
   * The last data that loaded. A failed reload sets the task's value to
   * `undefined`; the page keeps showing this instead.
   */
  private lastData?: DashboardData;

  data = new Task(this, {
    task: async () => {
      const [clubs, users, starters, acts, checkIns] = await Promise.all([
        unwrap(client.listClubs()),
        unwrap(client.listUsers()),
        unwrap(client.listStarters()),
        unwrap(client.listActs()),
        unwrap(client.listCheckIns()),
      ]);
      this.checkIns = checkInMap(checkIns);
      return { clubs, users, starters, acts } satisfies DashboardData;
    },
    args: () => [],
    onComplete: (value) => {
      this.lastData = value;
    },
  });

  override connectedCallback() {
    super.connectedCallback?.();
    window.addEventListener("hashchange", this.onHashChange);
  }

  override disconnectedCallback() {
    super.disconnectedCallback?.();
    window.removeEventListener("hashchange", this.onHashChange);
  }

  /** "#paare" (from the issues) scrolls to the unconfirmed pairs. */
  private onHashChange = () => {
    if (location.hash === "#paare" && this.pairsSection) {
      this.pairsSection.open = true;
      this.pairsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  checkInPoll = new PollController(this, 15000, (signal) =>
    this.refreshCheckIns(signal),
  );

  async refreshCheckIns(signal?: AbortSignal) {
    if (!(this.data.value ?? this.lastData)) {
      return;
    }
    this.checkIns = checkInMap(await unwrap(client.listCheckIns({ signal })));
  }

  override render() {
    const data = this.data.value ?? this.lastData;
    const pending = this.data.status === TaskStatus.PENDING;
    return html`<div class="page-pad">
      ${
        this.data.status === TaskStatus.ERROR
          ? html`<div class="error-banner" role="alert">
              <span
                >${
                  data
                    ? "Aktualisieren fehlgeschlagen, angezeigt wird der letzte Stand"
                    : "Übersicht konnte nicht geladen werden"
                }:
                ${errorMessage(this.data.error)}</span
              >
              <button class="btn small" @click=${this.onReloadClick}>
                Erneut versuchen
              </button>
            </div>`
          : nothing
      }
      ${
        this.error
          ? html`<div class="error-banner">
              ${this.error}
              <button
                class="icon-btn"
                title="Schließen"
                aria-label="Schließen"
                @click=${this.onCloseErrorClick}
              >
                close
              </button>
            </div>`
          : nothing
      }
      ${
        data
          ? this.renderDashboard(data, pending)
          : pending
            ? html`<p class="empty">Lädt Übersicht…</p>`
            : nothing
      }
    </div>`;
  }

  renderDashboard(data: DashboardData, pending: boolean) {
    const competition = this.systemStatus?.competition;
    const rows = buildClubRows(data, this.checkIns);
    const issues = buildIssues(data, rows, competition);
    const adminCount = data.users.filter((user) => user.is_admin).length;
    const roleHeaders = ROLES.map(
      (role) => html`<th class="role">${roleNames[role]}</th>`,
    );
    return html`
      <h1 class="sr-only">Übersicht</h1>
      ${this.renderKpis(data, rows)}
      ${this.renderIssues(issues)} ${this.renderUnconfirmedPairs(data)}
      <div class="toolbar">
        <h2>Vereine</h2>
        <input
          class="inline no-print"
          type="search"
          placeholder="Verein oder Kontakt suchen"
          aria-label="Verein oder Kontakt suchen"
          .value=${this.search}
          @input=${this.onSearchInput}
        />
        <span class="spacer"></span>
        <button
          class="btn small"
          ?disabled=${pending}
          title="Alle Daten neu laden"
          @click=${this.onReloadClick}
        >
          <span class="material-icon">refresh</span>
          ${pending ? "Lädt…" : "Aktualisieren"}
        </button>
      </div>
      ${this.renderClubTable(rows)}
      <details class="block" open>
        <summary>
          Nutzer
          <span class="muted">${data.users.length}</span>
        </summary>
        ${
          data.users.length
            ? html`<table class="dense fit">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>E-Mail</th>
                    <th>Status</th>
                    ${roleHeaders}
                  </tr>
                </thead>
                <tbody>
                  ${repeat(
                    data.users,
                    (u) => u.id,
                    (u) => html`<tr>
                      <td>${u.name}</td>
                      <td><a href="mailto:${u.email}">${u.email}</a></td>
                      <td>
                        <span class="chips">
                          ${
                            u.email_verified
                              ? html`<span class="chip ok">verifiziert</span>`
                              : html`<span class="chip warn"
                                  >unverifiziert</span
                                >`
                          }
                        </span>
                      </td>
                      ${this.renderRoleCells(u, adminCount)}
                    </tr>`,
                  )}
                </tbody>
              </table>`
            : html`<p class="empty">Keine Nutzer registriert.</p>`
        }
      </details>
    `;
  }

  /** A checkbox per role; locked where `roleLock` says so. */
  renderRoleCells(user: schemas.User, adminCount: number) {
    return ROLES.map((role) => {
      const lock = roleLock(user, role, this.currentUser?.id, adminCount);
      return html`<td class="role">
        <input
          type="checkbox"
          aria-label="${user.name}: ${roleNames[role]}"
          title=${lock ?? roleNames[role]}
          data-user-id=${user.id}
          data-role=${role}
          .checked=${user.roles.includes(role)}
          ?disabled=${this.updatingUserRoles.has(user.id) || lock !== null}
          @change=${this.onUserRoleChange}
        />
      </td>`;
    });
  }

  renderKpis(data: DashboardData, rows: ClubRow[]) {
    const unverified = data.users.filter((u) => !u.email_verified).length;
    const sum = (f: (row: ClubRow) => number) =>
      rows.reduce((total, row) => total + f(row), 0);
    const groupStarts = (type: Act["act_type"]) =>
      data.acts
        .filter((act) => act.act_type === type)
        .reduce((total, act) => total + act.participants.length, 0);
    const starts = {
      em: data.starters.filter((s) => s.single_male).length,
      ew: data.starters.filter((s) => s.single_female).length,
      p: data.starters.filter((s) => s.pair).length,
      kg: groupStarts("group_small"),
      gg: groupStarts("group_large"),
    };
    const totalStarts =
      starts.em + starts.ew + starts.p + starts.kg + starts.gg;
    const uncategorized = data.acts.filter((act) => !act.category).length;
    const groups = data.acts.filter((act) => isGroupActType(act.act_type));
    const incomplete = groups.filter(
      (act) => regularCount(act) < MIN_GROUP_SIZE,
    ).length;
    const withMusic = data.acts.filter((act) => act.song_file);
    const checked = withMusic.filter((act) => act.song_checked).length;
    const checkedIn = data.starters.filter((s) =>
      this.checkIns ? this.checkIns.get(s.id) : s.checked_in_at,
    ).length;
    const due = sum((row) => row.due);
    const paid = sum((row) => row.paid);
    const open = sum((row) => Math.max(0, row.open));

    return html`<div class="kpis">
      <span class="kpi"><b>${data.clubs.length}</b> Vereine</span>
      <span class="kpi"
        ><b>${data.users.length}</b> Nutzer${
          unverified
            ? html` (<span class="text-warn">${unverified} unverifiziert</span>)`
            : nothing
        }</span
      >
      <a class="kpi" href="/admin-starters"
        ><b>${data.starters.length}</b> Starter</a
      >
      <span
        class="kpi"
        title="Einzel männlich · Einzel weiblich · Paar · Kleingruppe · Großgruppe"
        ><b>${totalStarts}</b> Starts (EM ${starts.em} · EW ${starts.ew} · P
        ${starts.p} · KG ${starts.kg} · GG ${starts.gg})</span
      >
      <a class="kpi" href="/admin-acts-overview"
        ><b>${data.acts.length}</b> Küren${
          uncategorized
            ? html` (<span class="text-bad">${uncategorized} ohne Kategorie</span>)`
            : nothing
        }</a
      >
      <span class="kpi"
        ><b>${groups.length}</b> Gruppen${
          incomplete
            ? html` (<span class="text-warn">${incomplete} unvollständig</span>)`
            : nothing
        }</span
      >
      <span class="kpi"
        >Musik <b>${withMusic.length}/${data.acts.length}</b> · geprüft
        <b>${checked}/${withMusic.length}</b></span
      >
      <a class="kpi" href="/admin-check-in"
        >Eingecheckt <b>${checkedIn}/${data.starters.length}</b></a
      >
      ${this.renderJuryKpi(data)}
      <a class="kpi" href="/admin-payments"
        >Soll <b>${shortMoney(due)}</b> · Gezahlt <b>${shortMoney(paid)}</b> ·
        Offen
        <b class=${open > CENT ? "text-bad" : "text-ok"}
          >${shortMoney(open)}</b
        ></a
      >
    </div>`;
  }

  /** Clubs meeting their jury obligation, only with the jury registration. */
  renderJuryKpi(data: DashboardData) {
    const clubs = data.clubs.filter((club) => club.jury && club.jury.required);
    if (!this.systemStatus?.jury_registration || !clubs.length) {
      return nothing;
    }
    const met = clubs.filter((club) => club.jury!.missing === 0).length;
    return html`<a class="kpi" href="/admin-judges"
      >Jury-Pflicht erfüllt
      <b class=${met < clubs.length ? "text-bad" : "text-ok"}
        >${met}/${clubs.length}</b
      ></a
    >`;
  }

  renderIssues(issues: Issue[]) {
    if (!issues.length) {
      return html`<details class="block">
        <summary>
          Auffälligkeiten <span class="chip ok">keine</span>
        </summary>
        <p class="ok-line text-ok">Alles in Ordnung.</p>
      </details>`;
    }
    const total = issues.reduce((n, issue) => n + issue.items.length, 0);
    return html`<details class="block" open>
      <summary>
        Auffälligkeiten
        <span class="muted"
          >${total} in ${plural(issues.length, "Bereich", "Bereichen")}</span
        >
      </summary>
      <ul class="issues">
        ${repeat(
          issues,
          (issue) => issue.key,
          (issue) => html`<li>
            <details>
              <summary>
                <span class="chip ${issue.tone}">${issue.items.length}</span>
                <span class="label">${issue.label}</span>
                <span class="preview">${issue.items.join(" · ")}</span>
                <a href=${issue.href}>${issue.view} →</a>
              </summary>
              <ul class="items">
                ${repeat(
                  issue.items,
                  (_, i) => i,
                  (item) => html`<li>${item}</li>`,
                )}
              </ul>
            </details>
          </li>`,
        )}
      </ul>
    </details>`;
  }

  /**
   * Pair riders whose partner rides for another club. Both clubs register
   * their rider with the other's name; an admin links them here.
   */
  renderUnconfirmedPairs(data: DashboardData) {
    const pairs = unconfirmedPairs(data.starters);
    if (!pairs.length) {
      return html`<details class="block">
        <summary>
          Unbestätigte Paarküren <span class="chip ok">keine</span>
        </summary>
        <p class="ok-line text-ok">Alle vereinsübergreifenden Paare sind verbunden.</p>
      </details>`;
    }
    const matchLabels: Record<PairCandidate["match"], string> = {
      mutual: "Namen passen",
      exact: "Name passt einseitig",
      similar: "ähnlicher Name",
    };
    const rows = pairs.map(({ starter, partner, candidates }) => {
      const chosenId =
        this.pairChoice.get(starter.id) ?? partner?.starter.id ?? "";
      const chosen = candidates.find((c) => c.starter.id === chosenId);
      const busy = this.linking.has(starter.id);
      const suggested = new Set(candidates.map((c) => c.starter.id));
      const nameOf = (s: Starter) => `${s.firstname} ${s.lastname}`;
      const detail = (s: Starter) =>
        `(${s.club_name})${s.partner_name ? ` – nennt ${s.partner_name}` : ""}`;
      // The suggestions first; then everyone without a linked partner, for
      // pairs the names don't give away (e.g. first names only).
      const options: PickerOption[] = [
        ...candidates.map((c) => ({
          value: c.starter.id,
          label: nameOf(c.starter),
          detail: detail(c.starter),
          group: "Vorschläge",
        })),
        ...data.starters
          .filter(
            (s) => s.id !== starter.id && !s.partner_id && !suggested.has(s.id),
          )
          .sort(
            (a, b) =>
              a.firstname.localeCompare(b.firstname, "de") ||
              a.lastname.localeCompare(b.lastname, "de"),
          )
          .map((s) => ({
            value: s.id,
            label: nameOf(s),
            detail: detail(s),
            group: "Alle Fahrer ohne Partner",
          })),
      ];
      return html`<tr>
        <td>
          <a href="/?club=${encodeURIComponent(starter.club_id)}#kueren"
            >${starter.firstname} ${starter.lastname}</a
          >
          <span class="muted">(${starter.club_name})</span>
        </td>
        <td>
          ${
            starter.partner_name
              ? starter.partner_name
              : html`<span class="chip warn">kein Partner angegeben</span>`
          }
        </td>
        <td>
          <cup-rider-picker
            label="Partner für ${nameOf(starter)}"
            placeholder="Partner suchen…"
            data-id=${starter.id}
            .options=${options}
            .value=${chosenId}
            @change=${this.onPairChoice}
          ></cup-rider-picker>
          ${
            chosen
              ? html`<span
                  class="chip ${chosen.match === "similar" ? "warn" : chosen.match === "mutual" ? "ok" : "info"}"
                  >${matchLabels[chosen.match]}</span
                >`
              : chosenId
                ? html`<span class="chip">von Hand gewählt</span>`
                : candidates.length
                  ? nothing
                  : html`<span class="muted">kein Vorschlag</span>`
          }
        </td>
        <td class="actions">
          <button
            class="btn small ${chosen?.match === "mutual" ? "primary" : ""}"
            data-id=${starter.id}
            ?disabled=${!chosenId || busy}
            @click=${this.onConfirmPair}
          >
            ${busy ? "Verbindet…" : "Bestätigen"}
          </button>
        </td>
      </tr>`;
    });
    return html`<details class="block" id="paare" open>
      <summary>
        Unbestätigte Paarküren
        <span class="chip warn">${pairs.length}</span>
        <span class="muted"
          >Paare mit Partnern aus anderen Vereinen: prüfen und verbinden</span
        >
      </summary>
      <div class="scroll">
        <table class="dense fit">
          <thead>
            <tr>
              <th>Fahrer</th>
              <th>Nennt als Partner</th>
              <th>Partner</th>
              <th class="actions"></th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </details>`;
  }

  onPairChoice(e: CustomEvent<{ value: string }>) {
    const picker = e.currentTarget as HTMLElement;
    this.pairChoice = new Map(this.pairChoice).set(
      picker.dataset.id!,
      e.detail.value,
    );
  }

  /** Links the rider to the chosen partner; the server creates the act. */
  async onConfirmPair(e: Event) {
    const id = (e.currentTarget as HTMLElement).dataset.id!;
    const data = this.data.value ?? this.lastData;
    const starter = data?.starters.find((s) => s.id === id);
    const pair =
      data && unconfirmedPairs(data.starters).find((p) => p.starter.id === id);
    const partnerId = this.pairChoice.get(id) ?? pair?.partner?.starter.id;
    const partner = data?.starters.find((s) => s.id === partnerId);
    if (!starter || !partner || !data) {
      return;
    }
    this.linking = new Set(this.linking).add(id);
    try {
      // Also pairs riders who aren't registered for a pair yet.
      await linkPartners(starter, partner, data.starters);
      const choice = new Map(this.pairChoice);
      choice.delete(id);
      this.pairChoice = choice;
      this.data.run();
    } catch (error) {
      this.error = `Paar konnte nicht verbunden werden: ${errorMessage(error)}`;
    } finally {
      const linking = new Set(this.linking);
      linking.delete(id);
      this.linking = linking;
    }
  }

  renderClubTable(allRows: ClubRow[]) {
    if (!allRows.length) {
      return html`<p class="empty">Noch keine Vereine angemeldet.</p>`;
    }
    const needle = this.search.trim().toLowerCase();
    const rows = needle
      ? allRows.filter((row) =>
          [
            row.club.name,
            row.club.owner_name,
            row.club.owner_email,
            row.club.responsible_name,
            row.club.responsible_email,
          ].some((text) => text?.toLowerCase().includes(needle)),
        )
      : [...allRows];
    const { key, desc } = this.sort;
    rows.sort((a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      const order =
        typeof va === "string" || typeof vb === "string"
          ? String(va).localeCompare(String(vb), "de")
          : va - vb;
      return (desc ? -order : order) || a.club.name.localeCompare(b.club.name);
    });

    const sum = (f: (row: ClubRow) => number) =>
      rows.reduce((total, row) => total + f(row), 0);
    // Cross-club acts appear in several rows; count each act once.
    const acts = new Map(rows.flatMap((row) => row.acts.map((a) => [a.id, a])));
    const totalMusic = [...acts.values()].filter((a) => a.song_file);
    const totalChecked = totalMusic.filter((a) => a.song_checked).length;
    const totalStarters = sum((row) => row.starters.length);
    const open = sum((row) => Math.max(0, row.open));
    const overpaid = sum((row) => Math.max(0, -row.open));
    const competition = this.systemStatus?.competition;
    const musicTone =
      competition &&
      new Date(competition.music_upload_end).getTime() < Date.now()
        ? "text-bad"
        : "text-warn";

    return html`<div class="table-wrap"><table class="dense">
      <thead>
        <tr>
          ${this.renderSortHeader("name", "Verein")}
          ${this.renderSortHeader("contact", "Kontakt")}
          ${this.renderSortHeader("starters", "Starter", "num")}
          ${this.renderSortHeader("em", "EM", "num", "Einzel männlich")}
          ${this.renderSortHeader("ew", "EW", "num", "Einzel weiblich")}
          ${this.renderSortHeader("p", "P", "num", "Paar")}
          ${this.renderSortHeader("kg", "KG", "num", "Kleingruppe (Fahrer inkl. Ersatz)")}
          ${this.renderSortHeader("gg", "GG", "num", "Großgruppe (Fahrer inkl. Ersatz)")}
          ${this.renderSortHeader("acts", "Küren", "num", "Küren mit Fahrern des Vereins, vereinsübergreifende in jedem beteiligten Verein")}
          ${this.renderSortHeader("music", "Musik", "num", "Küren mit Musik")}
          ${this.renderSortHeader("checked", "geprüft", "num", "Geprüfte Musik")}
          ${this.renderSortHeader("checkedIn", "CI", "num", "Eingecheckte Starter")}
          ${this.renderSortHeader("due", "Soll", "num")}
          ${this.renderSortHeader("paid", "Gezahlt", "num", "Gezahlt gesamt")}
          ${this.renderSortHeader("open", "Offen", "num")}
          <th class="actions" aria-label="Details"></th>
        </tr>
      </thead>
      <tbody>
        ${repeat(
          rows,
          (row) => row.club.id,
          (row) => this.renderClubRow(row, musicTone),
        )}
        ${
          rows.length
            ? nothing
            : html`<tr>
                <td colspan="16" class="empty">Keine Treffer.</td>
              </tr>`
        }
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2">${plural(rows.length, "Verein", "Vereine")}</td>
          <td class="num">${totalStarters}</td>
          <td class="num">${sum((row) => row.em)}</td>
          <td class="num">${sum((row) => row.ew)}</td>
          <td class="num">${sum((row) => row.p)}</td>
          <td class="num">${sum((row) => row.kg)}</td>
          <td class="num">${sum((row) => row.gg)}</td>
          <td class="num" title="Jede Kür einmal gezählt">${acts.size}</td>
          <td class="num">
            ${fraction(totalMusic.length, acts.size, musicTone)}
          </td>
          <td class="num">
            ${fraction(totalChecked, totalMusic.length, "text-warn")}
          </td>
          <td class="num">
            ${fraction(
              sum((row) => row.checkedIn),
              totalStarters,
              "",
              "text-ok",
            )}
          </td>
          <td class="num">${formatMoney(sum((row) => row.due))}</td>
          <td class="num">${formatMoney(sum((row) => row.paid))}</td>
          <td
            class="num open-total"
            title="Summe der offenen Beträge, Überzahlungen nicht verrechnet"
          >
            ${
              open > CENT
                ? html`<span class="text-bad">${formatMoney(open)}</span>`
                : formatMoney(0)
            }
            ${
              overpaid > CENT
                ? html`<span class="chip info" title="überzahlt"
                    >+${formatMoney(overpaid)}</span
                  >`
                : nothing
            }
          </td>
          <td class="actions"></td>
        </tr>
      </tfoot>
    </table></div>`;
  }

  renderClubRow(row: ClubRow, musicTone: string) {
    const { club } = row;
    const href = `/?club=${encodeURIComponent(club.id)}`;
    return html`<tr>
        <td class="trunc name" title=${club.name}>
          <a href=${href}>${club.name}</a>
        </td>
        <td class="contact" title=${`${club.owner_name} <${club.owner_email}>`}>
          ${club.owner_name}
          <a
            class="email"
            href="mailto:${club.owner_email}"
            title=${club.owner_email}
            >${club.owner_email}</a
          >
          ${
            club.owner_email_verified
              ? nothing
              : html`<span class="chip warn">unverifiziert</span>`
          }
          ${
            responsibleIsContact(club)
              ? nothing
              : html`<br /><small
                    class="muted"
                    title=${`Vereinsverantwortliche/r: ${club.responsible_name} <${club.responsible_email}>`}
                    >Verantwortlich: ${club.responsible_name}
                    <a class="email" href="mailto:${club.responsible_email}"
                      >${club.responsible_email}</a
                    ></small
                  >`
          }
        </td>
        <td class="num">${count(row.starters.length)}</td>
        <td class="num">${count(row.em)}</td>
        <td class="num">${count(row.ew)}</td>
        <td class="num">${count(row.p)}</td>
        <td class="num">${count(row.kg)}</td>
        <td class="num">${count(row.gg)}</td>
        <td class="num">${count(row.acts.length)}</td>
        <td class="num">${fraction(row.music, row.acts.length, musicTone)}</td>
        <td class="num">${fraction(row.checked, row.music, "text-warn")}</td>
        <td class="num">
          ${fraction(row.checkedIn, row.starters.length, "", "text-ok")}
        </td>
        <td class="num">
          ${row.due ? formatMoney(row.due) : html`<span class="zero">${formatMoney(0)}</span>`}${
            club.amount_due?.jury_fee
              ? html`<br /><small
                    class="muted"
                    title="Startgeld ${formatMoney(club.amount_due.start_fees)} · Jurygebühr ${formatMoney(club.amount_due.jury_fee)}"
                    >davon Jury ${formatMoney(club.amount_due.jury_fee)}</small
                  >`
              : nothing
          }
        </td>
        <td class="num">
          ${
            club.payment === null || club.payment === undefined
              ? html`<span class="zero">–</span>`
              : formatMoney(club.payment)
          }
        </td>
        <td class="num">${openAmount(row.open, row.due)}</td>
        <td class="actions">
          <a
            class="icon-btn"
            href=${href}
            title="Verein öffnen: Fahrer, Küren und Startgeld"
            aria-label="${club.name} öffnen"
          >
            chevron_right
          </a>
        </td>
      </tr>`;
  }

  renderSortHeader(key: SortKey, label: string, cls = "", hint = "") {
    const sorted = this.sort.key === key;
    return html`<th
      class="sortable ${cls}"
      data-key=${key}
      title=${ifDefined(hint)}
      tabindex="0"
      aria-sort=${sorted ? (this.sort.desc ? "descending" : "ascending") : "none"}
      @click=${this.onSortClick}
      @keydown=${this.onSortKeydown}
    >
      ${label}
    </th>`;
  }

  onSortClick(e: Event) {
    const key = (e.currentTarget as HTMLElement).dataset.key as SortKey;
    this.sort =
      this.sort.key === key
        ? { key, desc: !this.sort.desc }
        : { key, desc: !textKeys.has(key) && !ratioKeys.has(key) };
  }

  onSortKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.onSortClick(e);
    }
  }

  onSearchInput(e: Event) {
    this.search = (e.target as HTMLInputElement).value;
  }

  onReloadClick() {
    this.data.run();
  }

  onCloseErrorClick() {
    this.error = null;
  }

  async onUserRoleChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const { userId, role } = input.dataset;
    const user = (this.data.value ?? this.lastData)?.users.find(
      (candidate) => candidate.id === userId,
    );
    if (!user || !userId || !role) {
      return;
    }

    this.updatingUserRoles = new Set(this.updatingUserRoles).add(userId);
    try {
      await unwrap(
        client.setUserRoles({
          body: {
            user_id: userId,
            roles: withRole(user.roles, role as Role, input.checked),
          },
        }),
      );
      await this.data.run();
    } catch (error) {
      this.error = `Nutzerrolle konnte nicht geändert werden: ${errorMessage(error)}`;
    } finally {
      const updating = new Set(this.updatingUserRoles);
      updating.delete(userId);
      this.updatingUserRoles = updating;
    }
  }
}
