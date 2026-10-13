import { consume } from "@lit/context";
import { Task, TaskStatus } from "@lit/task";
import { css, html, LitElement, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { errorMessage, unwrap } from "../../api";
import { client, type components } from "../../apiClient";
import {
  type SystemStatus,
  systemStatusContext,
} from "../../contexts/systemStatus";
import { adminStyles } from "../../styles/admin";
import { iconStyles, resetStyles } from "../../styles/base";
import {
  countStarts,
  formatDate,
  formatMoney,
  getStarterPrice,
} from "../../utils";

type ClubOverview = components["schemas"]["ClubOverview"];
type Starter = components["schemas"]["Starter"];

interface PaymentsData {
  clubs: ClubOverview[];
  starters: Starter[];
}

/** What the toolbar reports about the last save, with an undo. */
interface Notice {
  text: string;
  tone: "ok" | "warn";
  /** Sets the club's paid amount back to `amount`, if it is still `expected`. */
  undo?: { clubId: string; amount: number; expected: number };
}

/** One line of the payment table. */
interface PaymentRow {
  club: ClubOverview;
  starters: number;
  starts: number;
  /** Starts per type, for the tooltip. */
  em: number;
  ew: number;
  p: number;
  groups: number;
  due: number;
  paid: number;
  open: number;
}

type SortKey =
  | "name"
  | "contact"
  | "starters"
  | "starts"
  | "due"
  | "paid"
  | "open";

interface Sort {
  key: SortKey;
  desc: boolean;
}

/** Amounts below half a cent count as settled. */
const CENT = 0.005;

/** "1 Verein" / "2 Vereine". */
const clubCount = (n: number) => `${n} ${n === 1 ? "Verein" : "Vereine"}`;

const sortValue = (row: PaymentRow, key: SortKey): number | string => {
  switch (key) {
    case "name":
      return row.club.name;
    case "contact":
      return row.club.owner_name;
    default:
      return row[key];
  }
};

/**
 * Parses the amount typed into the payment field: a non-negative amount with
 * at most two decimals and "," or "." as decimal separator ("120", "120,5",
 * "120.50", "1.505,00 €"); `null` if invalid. A separator followed by three
 * digits is ambiguous ("1,505") and only accepted as German thousands
 * separator ("1.505").
 *
 * A plain text field is used on purpose: a number field in a browser with an
 * English locale silently turns "150,5" into 1505.
 */
const parseAmount = (text: string) => {
  const t = text.replace(/[\s\u00a0€]/g, "");
  const german = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(t);
  const plain = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(t);
  const match = german ?? plain;
  if (!match) {
    return null;
  }
  const value = Number(`${match[1].replaceAll(".", "")}.${match[2] ?? "0"}`);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
};

/**
 * The typed payment: an amount that replaces the paid total, or, with a
 * leading "+" ("+45"), one that is added to it. `null` if invalid.
 */
const parsePaymentInput = (text: string) => {
  const trimmed = text.trim();
  const add = trimmed.startsWith("+");
  const amount = parseAmount(add ? trimmed.slice(1) : trimmed);
  return amount === null ? null : { amount, add };
};

/** The paid amount as the editor shows it, e.g. "120,50". */
const amountInputValue = (amount: number | null | undefined) =>
  (amount ?? 0).toFixed(2).replace(".", ",");

/** Whether two paid amounts are equal; "nothing paid" counts as 0. */
const samePayment = (
  a: number | null | undefined,
  b: number | null | undefined,
) => Math.abs((a ?? 0) - (b ?? 0)) < CENT;

/**
 * Fees per club: what each club has to pay for its starters (group
 * memberships included), what it has paid and what is still open. The paid
 * amount is edited in place.
 */
@customElement("cup-view-admin-payments")
export default class CupViewAdminPayments extends LitElement {
  static override styles = [
    resetStyles,
    iconStyles,
    adminStyles,
    css`
      .head {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0 1rem;
      }

      .head h1 {
        margin-right: 0.25rem;
      }

      .zero {
        color: color-mix(in srgb, var(--cup-muted) 55%, transparent);
      }

      td.contact .email {
        display: inline-block;
        max-width: 18em;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: bottom;
        color: var(--cup-muted);
      }

      /* Wide enough for the editor, so the table doesn't jump. */
      td.paid {
        width: 14em;
      }

      td.paid .row {
        justify-content: flex-end;
        flex-wrap: nowrap;
        gap: 2px;
      }

      td.paid input {
        width: 6.5em;
      }

      .notice {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }

      /* The paid amount; a click opens the inline editor. */
      .pay-btn {
        display: inline-flex;
        align-items: baseline;
        gap: 0.25rem;
        padding: 0 4px;
        border: 1px dashed transparent;
        border-radius: 3px;
        background: none;
        color: inherit;
        font: inherit;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
      }

      .pay-btn:hover,
      .pay-btn:focus-visible {
        border-color: var(--cup-blue-2);
        background: var(--tone-info-bg);
        outline: none;
      }

      .pay-btn .material-icon {
        align-self: center;
        font-size: 14px;
        color: var(--cup-blue);
        visibility: hidden;
      }

      tr:hover .pay-btn .material-icon,
      .pay-btn:focus-visible .material-icon {
        visibility: visible;
      }

      tr.editing > td {
        background: var(--tone-info-bg);
      }
    `,
  ];

  @consume({ context: systemStatusContext, subscribe: true })
  systemStatus: SystemStatus | null = null;

  @state() sort: Sort = { key: "open", desc: true };
  @state() search = "";
  @state() onlyOpen = false;
  /** The club whose paid amount is being edited. */
  @state() editing: string | null = null;
  @state() saving = false;
  /** The typed amount couldn't be parsed. */
  @state() invalid = false;
  @state() error: string | null = null;
  @state() notice: Notice | null = null;

  @query("input.pay-input") payInput?: HTMLInputElement;

  /**
   * The paid amount the open editor started from. The typed amount replaces
   * the total, so saving is refused if the server's total differs from it
   * (another admin recorded a payment meanwhile).
   */
  private editBase: number | null = null;
  /** The text the editor opens with; kept when saving is refused. */
  private editText = "";
  /** Only the latest click on a paid amount opens the editor. */
  private editSeq = 0;
  /**
   * The last data that loaded. A failed reload sets the task's value to
   * `undefined`; the page keeps showing this instead.
   */
  private lastData?: PaymentsData;

  data = new Task(this, {
    task: async (): Promise<PaymentsData> => {
      const [clubs, starters] = await Promise.all([
        client.GET("/api/query/list_clubs").then(unwrap),
        client.GET("/api/query/list_starters").then(unwrap),
      ]);
      return { clubs, starters };
    },
    args: () => [],
    onComplete: (value) => {
      this.lastData = value;
    },
  });

  override updated(changed: Map<PropertyKey, unknown>) {
    super.updated(changed);
    if (changed.has("editing") && this.editing && this.payInput) {
      this.payInput.focus();
      this.payInput.select();
    }
  }

  override render() {
    const data = this.data.value ?? this.lastData;
    return html`<div class="page-pad">
      ${
        this.data.status === TaskStatus.ERROR
          ? html`<div class="error-banner" role="alert">
              <span
                >${
                  data
                    ? "Aktualisieren fehlgeschlagen, angezeigt wird der letzte Stand"
                    : "Zahlungen konnten nicht geladen werden"
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
        data
          ? this.renderPayments(data.clubs, data.starters)
          : this.data.status === TaskStatus.PENDING
            ? html`<p class="empty">Lädt Zahlungen…</p>`
            : nothing
      }
    </div>`;
  }

  buildRows(clubs: ClubOverview[], starters: Starter[]): PaymentRow[] {
    const competition = this.systemStatus?.competition;
    const rows = new Map<string, PaymentRow>(
      clubs.map((club) => [
        club.id,
        {
          club,
          starters: 0,
          starts: 0,
          em: 0,
          ew: 0,
          p: 0,
          groups: 0,
          due: 0,
          paid: club.payment ?? 0,
          open: 0,
        },
      ]),
    );
    for (const starter of starters) {
      const row = rows.get(starter.club_id);
      if (!row) {
        continue;
      }
      row.starters += 1;
      row.starts += countStarts(starter);
      row.em += Number(starter.single_male);
      row.ew += Number(starter.single_female);
      row.p += Number(starter.pair);
      row.groups += starter.group_count;
      row.due += getStarterPrice(starter, competition);
    }
    for (const row of rows.values()) {
      row.open = row.due - row.paid;
    }
    return [...rows.values()];
  }

  renderPayments(clubs: ClubOverview[], starters: Starter[]) {
    const competition = this.systemStatus?.competition;
    const allRows = this.buildRows(clubs, starters);
    const needle = this.search.trim().toLowerCase();
    const rows = allRows.filter(
      (row) =>
        (!this.onlyOpen || row.open > CENT || row.club.id === this.editing) &&
        (!needle ||
          [
            row.club.name,
            row.club.code,
            row.club.owner_name,
            row.club.owner_email,
          ].some((text) => text.toLowerCase().includes(needle))),
    );
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

    const sum = (list: PaymentRow[], f: (row: PaymentRow) => number) =>
      list.reduce((total, row) => total + f(row), 0);
    const openRows = allRows.filter((row) => row.open > CENT);
    const overpaidRows = allRows.filter((row) => row.open < -CENT);
    const deadline = competition?.payment_deadline;
    const deadlineOver =
      !!deadline && new Date(`${deadline}T23:59:59`).getTime() < Date.now();

    return html`
      <div class="head">
        <h1>Zahlungen</h1>
        <div class="kpis">
          <span class="kpi"><b>${allRows.length}</b> Vereine</span>
          <span class="kpi"
            >Soll <b>${formatMoney(sum(allRows, (r) => r.due))}</b></span
          >
          <span class="kpi"
            >Gezahlt <b>${formatMoney(sum(allRows, (r) => r.paid))}</b></span
          >
          <span class="kpi ${openRows.length ? "bad" : "ok"}"
            >Offen
            <b>${formatMoney(sum(openRows, (r) => r.open))}</b>
            (${clubCount(openRows.length)})</span
          >
          ${
            overpaidRows.length
              ? html`<span class="kpi"
                  >Überzahlt
                  <b class="text-info"
                    >${formatMoney(-sum(overpaidRows, (r) => r.open))}</b
                  >
                  (${clubCount(overpaidRows.length)})</span
                >`
              : nothing
          }
          ${
            competition
              ? html`<span class="kpi"
                  >${formatMoney(competition.fee_per_start)} je Start${
                    competition.max_fee_per_starter === null ||
                    competition.max_fee_per_starter === undefined
                      ? nothing
                      : html`, max. ${formatMoney(
                          competition.max_fee_per_starter,
                        )} je Starter`
                  }</span
                >`
              : nothing
          }
          ${
            deadline
              ? html`<span class="kpi"
                  >Zahlungsfrist
                  <b class=${deadlineOver ? "text-bad" : ""}
                    >${formatDate(deadline)}</b
                  >${deadlineOver ? " (abgelaufen)" : nothing}</span
                >`
              : nothing
          }
        </div>
      </div>
      <div class="toolbar">
        <input
          class="inline no-print"
          type="search"
          placeholder="Verein oder Kontakt suchen"
          aria-label="Verein oder Kontakt suchen"
          .value=${this.search}
          @input=${this.onSearchInput}
        />
        <button
          class="chip no-print"
          aria-pressed=${this.onlyOpen ? "true" : "false"}
          @click=${this.onOnlyOpenClick}
        >
          nur offene (${openRows.length})
        </button>
        <span class="muted small no-print">
          Gezahlten Betrag anklicken zum Bearbeiten · „+45“ addiert · Enter
          speichert · Esc bricht ab
        </span>
        <span class="spacer"></span>
        ${
          this.notice
            ? html`<span
                class="notice ${this.notice.tone === "warn" ? "text-warn" : "text-ok"}"
                role="status"
                >${this.notice.text}${
                  this.notice.undo
                    ? html`<button
                        class="btn small no-print"
                        title="Den vorherigen Betrag wiederherstellen"
                        ?disabled=${this.saving}
                        @click=${this.onUndoClick}
                      >
                        Rückgängig
                      </button>`
                    : nothing
                }</span
              >`
            : nothing
        }
        <button
          class="btn small"
          ?disabled=${this.data.status === TaskStatus.PENDING}
          title="Vereine und Starter neu laden"
          @click=${this.onReloadClick}
        >
          <span class="material-icon">refresh</span>
          Aktualisieren
        </button>
      </div>
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
        allRows.length
          ? html`<table class="dense">
              <thead>
                <tr>
                  ${this.renderSortHeader("name", "Verein")}
                  ${this.renderSortHeader("contact", "Kontakt")}
                  ${this.renderSortHeader("starters", "Starter", "num")}
                  ${this.renderSortHeader(
                    "starts",
                    "Starts",
                    "num",
                    "Einzel, Paar und Gruppen (inkl. Ersatz)",
                  )}
                  ${this.renderSortHeader("due", "Soll", "num")}
                  ${this.renderSortHeader(
                    "paid",
                    "Gezahlt gesamt",
                    "num",
                    "Bisher insgesamt gezahlter Betrag; beim Bearbeiten wird er ersetzt, mit „+“ davor (z. B. +45) wird addiert",
                  )}
                  ${this.renderSortHeader("open", "Offen", "num")}
                </tr>
              </thead>
              <tbody>
                ${repeat(
                  rows,
                  (row) => row.club.id,
                  (row) => this.renderRow(row),
                )}
                ${
                  rows.length
                    ? nothing
                    : html`<tr>
                        <td colspan="7" class="empty">
                          ${
                            this.onlyOpen && !needle
                              ? "Keine offenen Beträge."
                              : "Keine Treffer."
                          }
                        </td>
                      </tr>`
                }
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="2">
                    ${
                      rows.length === allRows.length
                        ? clubCount(rows.length)
                        : `${rows.length} von ${clubCount(allRows.length)}`
                    }
                  </td>
                  <td class="num">${sum(rows, (r) => r.starters)}</td>
                  <td class="num">
                    ${sum(rows, (r) => r.starts)}
                  </td>
                  <td class="num">${formatMoney(sum(rows, (r) => r.due))}</td>
                  <td class="num">${formatMoney(sum(rows, (r) => r.paid))}</td>
                  <td
                    class="num"
                    title="Summe der offenen Beträge, Überzahlungen nicht verrechnet"
                  >
                    ${this.renderOpen(
                      sum(rows, (r) => Math.max(0, r.open)),
                      1,
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>`
          : html`<p class="empty">Noch keine Vereine angemeldet.</p>`
      }
    `;
  }

  renderRow(row: PaymentRow) {
    const { club } = row;
    const editing = this.editing === club.id;
    return html`<tr class=${editing ? "editing" : ""}>
      <td class="trunc" title="${club.name} · Code im Verwendungszweck: ${club.code}">
        ${club.name} <span class="muted small">${club.code}</span>
      </td>
      <td class="contact">
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
      </td>
      <td class="num">
        ${row.starters || html`<span class="zero">0</span>`}
      </td>
      <td
        class="num"
        title="EM ${row.em} · EW ${row.ew} · P ${row.p} · Gruppen ${row.groups}"
      >
        ${row.starts || html`<span class="zero">0</span>`}
      </td>
      <td class="num">
        ${
          row.due
            ? formatMoney(row.due)
            : html`<span class="zero">${formatMoney(0)}</span>`
        }
      </td>
      <td class="num paid">
        ${
          editing
            ? html`<span class="row">
                <input
                  class="inline num pay-input ${this.invalid ? "invalid" : ""}"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  aria-label="Gezahlt gesamt in Euro, mit + davor wird addiert"
                  aria-invalid=${this.invalid ? "true" : "false"}
                  data-id=${club.id}
                  .value=${this.editText}
                  ?disabled=${this.saving}
                  @input=${this.onPayInput}
                  @keydown=${this.onPayKeydown}
                />
                <button
                  class="btn small"
                  data-due=${row.due}
                  title="Soll übernehmen (${formatMoney(row.due)})"
                  ?disabled=${this.saving}
                  @click=${this.onDueClick}
                >
                  = Soll
                </button>
                <button
                  class="icon-btn ok"
                  data-id=${club.id}
                  title="Speichern (Enter)"
                  aria-label="Speichern"
                  ?disabled=${this.saving}
                  @click=${this.onSaveClick}
                >
                  check
                </button>
                <button
                  class="icon-btn"
                  title="Abbrechen (Esc)"
                  aria-label="Abbrechen"
                  ?disabled=${this.saving}
                  @click=${this.onCancelClick}
                >
                  close
                </button>
              </span>`
            : html`<button
                class="pay-btn"
                data-id=${club.id}
                title="Gezahlten Betrag bearbeiten"
                aria-label="Gezahlten Betrag von ${club.name} bearbeiten"
                @click=${this.onEditClick}
              >
                <span class="material-icon">edit</span>
                ${
                  club.payment === null || club.payment === undefined
                    ? html`<span class="zero">–</span>`
                    : formatMoney(club.payment)
                }
              </button>`
        }
      </td>
      <td class="num">${this.renderOpen(row.open, row.due)}</td>
    </tr>`;
  }

  /** Red if owed, green if settled, a blue chip if overpaid. */
  renderOpen(open: number, due: number) {
    if (open > CENT) {
      return html`<b class="text-bad">${formatMoney(open)}</b>`;
    }
    if (open < -CENT) {
      return html`<span class="chip info" title="überzahlt"
        >überzahlt ${formatMoney(-open)}</span
      >`;
    }
    return due > 0
      ? html`<span class="text-ok">${formatMoney(0)}</span>`
      : html`<span class="zero">${formatMoney(0)}</span>`;
  }

  renderSortHeader(key: SortKey, label: string, cls = "", hint = "") {
    const sorted = this.sort.key === key;
    return html`<th
      class="sortable ${cls}"
      data-key=${key}
      title=${hint || nothing}
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
        : { key, desc: key !== "name" && key !== "contact" };
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

  onOnlyOpenClick() {
    this.onlyOpen = !this.onlyOpen;
  }

  /** A club of the shown data. */
  findClub(id: string | undefined) {
    return (this.data.value ?? this.lastData)?.clubs.find((c) => c.id === id);
  }

  /**
   * Reloads the paid amounts into the shown data: other admins (or the club
   * manager on the dashboard) may have recorded payments meanwhile. Returns
   * the club's current state on the server.
   */
  async reloadPayments(clubId: string) {
    const fresh = unwrap(
      await client.GET("/api/query/list_clubs", {
        signal: AbortSignal.timeout(10000),
      }),
    );
    const byId = new Map(fresh.map((club) => [club.id, club]));
    let changed = false;
    for (const club of (this.data.value ?? this.lastData)?.clubs ?? []) {
      const current = byId.get(club.id);
      if (current && (current.payment ?? null) !== (club.payment ?? null)) {
        club.payment = current.payment;
        changed = true;
      }
    }
    if (changed) {
      this.requestUpdate();
    }
    const club = byId.get(clubId);
    if (!club) {
      throw new Error("Verein nicht gefunden – bitte neu laden");
    }
    return club;
  }

  async onEditClick(e: Event) {
    if (this.saving) {
      return;
    }
    const id = (e.currentTarget as HTMLElement).dataset.id!;
    const seq = ++this.editSeq;
    const before = this.findClub(id)?.payment ?? null;
    this.error = null;
    // Open the editor with the current total, not the one from page load.
    let fresh: ClubOverview | null = null;
    try {
      fresh = await this.reloadPayments(id);
    } catch (error) {
      this.error = `Aktueller Betrag konnte nicht geladen werden, angezeigt wird der letzte Stand: ${errorMessage(error)}`;
    }
    const club = this.findClub(id);
    if (seq !== this.editSeq || this.saving || !club) {
      return;
    }
    if (fresh && !samePayment(fresh.payment, before)) {
      this.notice = {
        text: `Betrag von ${club.name} wurde inzwischen geändert: jetzt ${formatMoney(fresh.payment ?? 0)}`,
        tone: "warn",
      };
    }
    this.editBase = club.payment ?? null;
    this.editText = amountInputValue(club.payment);
    this.invalid = false;
    this.editing = id;
  }

  onCancelClick() {
    this.editing = null;
    this.error = null;
  }

  onSaveClick() {
    if (this.payInput) {
      this.savePayment(this.payInput);
    }
  }

  onDueClick(e: Event) {
    const input = this.payInput;
    if (!input) {
      return;
    }
    input.value = amountInputValue(
      Number((e.currentTarget as HTMLElement).dataset.due),
    );
    this.invalid = false;
    input.focus();
    input.select();
  }

  onPayInput() {
    this.invalid = false;
  }

  onPayKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      this.savePayment(e.currentTarget as HTMLInputElement);
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.onCancelClick();
    }
  }

  async savePayment(input: HTMLInputElement) {
    const club = this.findClub(input.dataset.id);
    if (!club || this.saving) {
      return;
    }
    const parsed = parsePaymentInput(input.value);
    if (parsed === null) {
      this.invalid = true;
      this.error =
        "Bitte einen gültigen Betrag ab 0 € mit höchstens zwei Nachkommastellen eingeben, z. B. 120,50 (oder +45 zum Addieren).";
      input.focus();
      return;
    }
    this.saving = true;
    this.error = null;
    // Keep the typed text if saving is refused.
    this.editText = input.value;
    try {
      // The amount replaces the total: don't overwrite a payment recorded
      // elsewhere since the editor opened.
      const current = (await this.reloadPayments(club.id)).payment ?? null;
      if (!parsed.add && !samePayment(current, this.editBase)) {
        this.editBase = current;
        this.error = `Nicht gespeichert: Der gezahlte Betrag von „${club.name}“ wurde inzwischen auf ${formatMoney(current ?? 0)} geändert. Bitte die Eingabe prüfen (oder mit „+“ addieren) und erneut speichern.`;
        return;
      }
      const amount = parsed.add
        ? Math.round(((current ?? 0) + parsed.amount) * 100) / 100
        : parsed.amount;
      unwrap(
        await client.POST("/api/command/set_payment", {
          body: { club_id: club.id, amount },
        }),
      );
      club.payment = amount;
      this.editing = null;
      this.notice = {
        text: `Gespeichert: ${club.name} ${formatMoney(current ?? 0)} → ${formatMoney(amount)}`,
        tone: "ok",
        undo: samePayment(current, amount)
          ? undefined
          : { clubId: club.id, amount: current ?? 0, expected: amount },
      };
    } catch (error) {
      this.error = `Zahlung für „${club.name}“ nicht gespeichert: ${errorMessage(error)}`;
    } finally {
      this.saving = false;
    }
    if (this.editing) {
      // Saving failed: keep the field open for another try.
      await this.updateComplete;
      this.payInput?.focus();
    }
  }

  /** Sets the paid amount back, unless it was changed again meanwhile. */
  async onUndoClick() {
    const undo = this.notice?.undo;
    const club = this.findClub(undo?.clubId);
    if (!undo || !club || this.saving) {
      return;
    }
    this.saving = true;
    this.error = null;
    try {
      const current = (await this.reloadPayments(club.id)).payment ?? null;
      if (!samePayment(current, undo.expected)) {
        this.notice = null;
        this.error = `Nicht rückgängig gemacht: Der gezahlte Betrag von „${club.name}“ wurde inzwischen auf ${formatMoney(current ?? 0)} geändert.`;
        return;
      }
      unwrap(
        await client.POST("/api/command/set_payment", {
          body: { club_id: club.id, amount: undo.amount },
        }),
      );
      // An editor open for this club keeps its old base: saving it is then
      // refused as a conflict, so nothing is overwritten unseen.
      club.payment = undo.amount;
      this.notice = {
        text: `Rückgängig gemacht: ${club.name} wieder ${formatMoney(undo.amount)}`,
        tone: "ok",
      };
    } catch (error) {
      this.error = `Rückgängig für „${club.name}“ fehlgeschlagen: ${errorMessage(error)}`;
    } finally {
      this.saving = false;
    }
  }

  onReloadClick() {
    this.editing = null;
    this.data.run();
  }

  onCloseErrorClick() {
    this.error = null;
  }
}
