import { Task, TaskStatus } from "@lit/task";
import { css, html, LitElement, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { repeat } from "lit/directives/repeat.js";
import { errorMessage, PollController, unwrap } from "../../api";
import { client, type components } from "../../apiClient";
import { adminStyles } from "../../styles/admin";
import { iconStyles, resetStyles } from "../../styles/base";
import { formatDateTime, formatDuration, parseDuration } from "../../utils";

type Category = components["schemas"]["Category"];
type Entry = components["schemas"]["TimeplanListEntry"];
type TimeplanItem = components["schemas"]["TimeplanItem"];

/** The row being edited, with the values as typed. */
interface EntryDraft {
  /** `datetime-local` value in local time, "" for none. */
  earliest: string;
  /** Category name, "" for a custom entry (break, award ceremony, …). */
  category: string;
  label: string;
  /** Custom entries only: "m:ss" or plain seconds. */
  duration: string;
}

interface Editing {
  /** The edited entry, `null` for a new one. */
  original: Entry | null;
  draft: EntryDraft;
  /** Whether the earliest start was touched; otherwise it is kept as it is. */
  earliestChanged: boolean;
}

interface Data {
  entries: Entry[];
  categories: Map<string, Category>;
  actCounts: Map<string, number>;
  /** The prediction per entry (same index), if it is available. */
  predictions: (TimeplanItem | undefined)[];
  /** Delay of the running timeplan in seconds, if predicted. */
  offset: number | null;
  /** Why there is no prediction, "" if there is one. */
  predictionError: string;
}

const statusChips = {
  planned: { label: "geplant", tone: "muted" },
  started: { label: "läuft", tone: "info" },
  ended: { label: "beendet", tone: "ok" },
} as const;

const entryStatus = (entry: Entry) =>
  entry.ended_at ? "ended" : entry.started_at ? "started" : "planned";

/** A date-time as the value of a `datetime-local` input, in local time. */
const toLocalInput = (value: string | null | undefined) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
};

/**
 * The value of a `datetime-local` input (local time) for the backend, as
 * RFC 3339 in UTC; `null` if empty or invalid. The backend stores the string
 * as it is, so it must not be built by appending to the input's value.
 */
const toServerTime = (value: string) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

/** The backend's (English) reasons why there is no prediction, in German. */
const predictionErrorMessage = (message: string) => {
  if (message.includes("Earliest start time is not set")) {
    return "Der erste Eintrag braucht eine früheste Startzeit.";
  }
  if (message.includes("No first entry")) {
    return "";
  }
  if (message.includes("Invalid timeplan entry")) {
    return "Ein Eintrag ist unvollständig: eigene Einträge brauchen Bezeichnung und Dauer.";
  }
  return message;
};

/** Pairs the prediction's items with the entries (both are ordered by id). */
const matchPredictions = (
  entries: Entry[],
  items: TimeplanItem[] | undefined,
) => {
  if (!items || items.length !== entries.length) {
    return [];
  }
  return entries.map((entry, i) => {
    const item = items[i].timeplan_entry;
    const matches =
      "Category" in item
        ? item.Category.name === entry.category
        : !entry.category && item.Custom.label === entry.label;
    return matches ? items[i] : undefined;
  });
};

const entryName = (entry: Entry) => entry.category ?? entry.label ?? "";

/**
 * The prediction starts at the first entry's earliest start. When `next`
 * becomes the first entry (moving or deleting the current first one) and has
 * no earliest start, it takes over the current first entry's; `null` if
 * nothing has to be carried over.
 */
const carryOver = (entries: Entry[], next: Entry | undefined) => {
  const start = entries[0]?.earliest_start_time;
  return next && next !== entries[0] && start && !next.earliest_start_time
    ? { entry: next, start }
    : null;
};

/** Sets the carried-over earliest start (see `carryOver`). */
const applyCarryOver = async (carry: ReturnType<typeof carryOver>) => {
  if (!carry) {
    return;
  }
  const { entry, start } = carry;
  // edit_timeplan_entry overwrites every field: send the others back as the
  // server returned them.
  unwrap(
    await client.POST("/api/command/edit_timeplan_entry", {
      body: {
        id: entry.id,
        earliest_start_time: start,
        category: entry.category ?? null,
        label: entry.label ?? null,
        duration_seconds: entry.duration_seconds ?? null,
      },
    }),
  );
};

@customElement("cup-view-admin-timeplan")
export default class CupViewAdminTimeplan extends LitElement {
  static override styles = [
    resetStyles,
    iconStyles,
    adminStyles,
    css`
      .toolbar h1 {
        margin: 0 0.5rem 0 0;
      }

      input.dur {
        width: 4.5em;
      }

      input.label {
        width: 14em;
      }

      .entry-edit {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }

      tr.editing > td {
        background: var(--tone-info-bg);
      }
    `,
  ];

  @state() private editing: Editing | null = null;
  @state() private busy = false;
  @state() private error = "";
  /** The failed reload whose banner was closed. */
  @state() private dismissedError: unknown;

  @query("tr.editing input[data-field=earliest]")
  private editEarliestInput?: HTMLInputElement | null;

  /** The last loaded data: a failed reload keeps showing it. */
  private last?: Data;

  private data = new Task(this, {
    args: () => [],
    // The next run aborts a hanging one through `signal`, e.g. the next poll
    // after the PollController gave up on it.
    task: async (_args, { signal }): Promise<Data> => {
      const [entries, categories, acts, prediction] = await Promise.all([
        client.GET("/api/query/list_timeplan", { signal }),
        client.GET("/api/query/list_categories", { signal }),
        client.GET("/api/query/list_acts", { signal }),
        client.GET("/api/query/predict_timeplan", { signal }),
      ]);
      const list = unwrap(entries);
      const actCounts = new Map<string, number>();
      for (const act of unwrap(acts)) {
        if (act.category) {
          actCounts.set(act.category, (actCounts.get(act.category) ?? 0) + 1);
        }
      }
      // The prediction fails while the timeplan is incomplete; the list is
      // still shown then.
      let timeplan: components["schemas"]["Timeplan"] | null = null;
      let predictionError = "";
      try {
        timeplan = unwrap(prediction);
      } catch (error) {
        predictionError = predictionErrorMessage(errorMessage(error));
      }
      this.last = {
        entries: list,
        categories: new Map(unwrap(categories).map((c) => [c.name, c])),
        actCounts,
        predictions: matchPredictions(list, timeplan?.items),
        offset: timeplan?.offset ?? null,
        predictionError,
      };
      return this.last;
    },
  });

  // Started/ended entries and the predicted times change during the event.
  // Not while a row is edited, so the rows don't change under the edit row.
  poll = new PollController(this, 20000, () =>
    this.busy || this.editing ? undefined : this.data.run(),
  );

  /** The current data, or the last loaded one while a reload failed. */
  private get current() {
    return this.data.value ?? this.last;
  }

  override render() {
    const data = this.current;
    return html`<div class="page-pad">
      <div class="toolbar">
        <h1>Zeitplan</h1>
        ${data ? this.renderKpis(data) : nothing}
        <span class="spacer"></span>
        <button
          class="btn primary small"
          title=${this.editing ? "Erst speichern oder abbrechen" : nothing}
          ?disabled=${!data || this.busy || this.editing !== null}
          @click=${this.startNew}
        >
          <span class="material-icon">add</span> Neuer Eintrag
        </button>
      </div>
      ${
        this.error
          ? html`<div class="error-banner" role="alert">
            <span>${this.error}</span>
            <button
              class="icon-btn"
              title="Schließen"
              aria-label="Schließen"
              @click=${this.clearError}
            >
              close
            </button>
          </div>`
          : nothing
      }
      ${this.renderReloadError()}
      ${
        data?.predictionError
          ? html`<div class="warn-banner">
              Keine Zeitprognose: ${data.predictionError}
            </div>`
          : data?.entries[0] && !data.entries[0].earliest_start_time
            ? html`<div class="warn-banner">
                Der erste Eintrag braucht eine früheste Startzeit: ab ihr
                wird der Zeitplan berechnet.
              </div>`
            : nothing
      }
      ${
        data
          ? this.renderTable(data)
          : this.data.render({
              pending: () => html`<p class="empty">Lade Zeitplan …</p>`,
              error: (error) =>
                html`<div class="error-banner" role="alert">
                  Zeitplan konnte nicht geladen werden: ${errorMessage(error)}
                </div>`,
            })
      }
    </div>`;
  }

  /** A failed reload keeps the last data; this says so and offers a retry. */
  private renderReloadError() {
    const error = this.data.error;
    if (
      this.data.status !== TaskStatus.ERROR ||
      !this.last ||
      error === this.dismissedError
    ) {
      return nothing;
    }
    return html`<div class="error-banner" role="alert">
      <span
        >Neu laden fehlgeschlagen: ${errorMessage(error)} – angezeigt wird der
        letzte Stand.</span
      >
      <button class="btn small" ?disabled=${this.busy} @click=${this.reload}>
        Erneut laden
      </button>
      <button
        class="icon-btn"
        title="Schließen"
        aria-label="Schließen"
        @click=${this.dismissReloadError}
      >
        close
      </button>
    </div>`;
  }

  private renderKpis(data: Data) {
    const first = data.predictions[0];
    const last = data.predictions.at(-1);
    const planned = new Set(data.entries.map((e) => e.category));
    const missing = [...data.categories.keys()].filter((c) => !planned.has(c));
    const running = data.entries.find((e) => entryStatus(e) === "started");
    return html`<div class="kpis">
      <span class="kpi"><b>${data.entries.length}</b> Einträge</span>
      ${
        first
          ? html`<span class="kpi" title="Geplanter Beginn"
              >Beginn <b>${formatDateTime(first.planned_start)}</b></span
            >`
          : nothing
      }
      ${
        last
          ? html`<span class="kpi" title="Voraussichtliches Ende"
              >Ende <b>${formatDateTime(last.predicted_end)}</b></span
            >`
          : nothing
      }
      ${
        data.offset !== null && running
          ? html`<span
              class=${classMap({
                kpi: true,
                ok: data.offset <= 0,
                warn: data.offset > 0 && data.offset <= 900,
                bad: data.offset > 900,
              })}
              title="Abweichung vom geplanten Ablauf"
              >${data.offset > 0 ? "Verzug" : "Vorsprung"}
              <b>${formatDuration(Math.abs(data.offset))}</b></span
            >`
          : nothing
      }
      ${
        running
          ? html`<span class="kpi">läuft: <b>${entryName(running)}</b></span>`
          : nothing
      }
      ${
        missing.length
          ? html`<span class="kpi warn" title=${missing.join(", ")}
              ><b>${missing.length}</b>
              ${missing.length === 1 ? "Kategorie" : "Kategorien"} nicht im
              Zeitplan</span
            >`
          : nothing
      }
    </div>`;
  }

  /** Planned length of an entry: the category block or the custom duration. */
  private entryDuration(data: Data, entry: Entry) {
    if (!entry.category) {
      return { seconds: entry.duration_seconds ?? null, title: "" };
    }
    const category = data.categories.get(entry.category);
    if (!category) {
      return { seconds: null, title: "" };
    }
    const acts = data.actCounts.get(entry.category) ?? 0;
    if (acts === 0) {
      // timeplan_forward ends an empty category right away: no warm-up.
      return { seconds: 0, title: "Keine Küren: wird übersprungen" };
    }
    const per =
      (category.act_duration_seconds ?? 0) +
      (category.judge_duration_seconds ?? 0);
    return {
      seconds: (category.einfahrzeit_seconds ?? 0) + acts * per,
      title:
        `${formatDuration(category.einfahrzeit_seconds)} Einfahren + ${acts} × ` +
        `(${formatDuration(category.act_duration_seconds)} Kür + ` +
        `${formatDuration(category.judge_duration_seconds)} Bewertung)`,
    };
  }

  private renderTable(data: Data) {
    const last = data.entries.length - 1;
    let totalActs = 0;
    let totalSeconds = 0;
    for (const entry of data.entries) {
      totalActs += entry.category
        ? (data.actCounts.get(entry.category) ?? 0)
        : 0;
      totalSeconds += this.entryDuration(data, entry).seconds ?? 0;
    }
    return html`<table class="dense">
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Status</th>
          <th title="Frühestens zu dieser Zeit beginnen">Frühester Start</th>
          <th
            title="Voraussichtlicher Start; tatsächliche Zeit, sobald gestartet"
          >
            Start
          </th>
          <th title="Voraussichtliches Ende; tatsächliche Zeit, sobald beendet">
            Ende
          </th>
          <th>Eintrag</th>
          <th class="num" title="Küren der Kategorie">Küren</th>
          <th
            class="num"
            title="Kategorien: Einfahren + Küren × (Kür + Bewertung); ohne Küren 0:00"
          >
            Dauer
          </th>
          <th class="actions" aria-label="Aktionen"></th>
        </tr>
      </thead>
      <tbody>
        ${repeat(
          data.entries,
          (entry) => entry.id,
          (entry, index) =>
            this.editing?.original?.id === entry.id
              ? this.renderEditRow(data, this.editing, index)
              : this.renderRow(data, entry, index, last),
        )}
        ${
          this.editing && !this.editing.original
            ? this.renderEditRow(data, this.editing, data.entries.length)
            : nothing
        }
        ${
          data.entries.length === 0 && !this.editing
            ? html`<tr>
              <td colspan="9" class="empty">Der Zeitplan ist noch leer.</td>
            </tr>`
            : nothing
        }
      </tbody>
      <tfoot>
        <tr>
          <td colspan="6">Summe</td>
          <td class="num">${totalActs}</td>
          <td class="num">${formatDuration(totalSeconds)}</td>
          <td class="actions"></td>
        </tr>
      </tfoot>
    </table>`;
  }

  private renderStatus(entry: Entry) {
    const status = entryStatus(entry);
    const chip = statusChips[status];
    const title = [
      entry.started_at && `Gestartet ${formatDateTime(entry.started_at)}`,
      entry.ended_at && `Beendet ${formatDateTime(entry.ended_at)}`,
    ]
      .filter(Boolean)
      .join(" · ");
    return html`<span class="chip ${chip.tone}" title=${title || nothing}
      >${chip.label}</span
    >`;
  }

  private renderEntry(data: Data, entry: Entry) {
    if (!entry.category) {
      return entry.label ?? "";
    }
    const description = data.categories.get(entry.category)?.description;
    return html`<b>${entry.category}</b>
      ${description ? html`<span class="muted">${description}</span>` : nothing}`;
  }

  private renderRow(data: Data, entry: Entry, index: number, last: number) {
    const status = entryStatus(entry);
    const prediction = data.predictions[index];
    const duration = this.entryDuration(data, entry);
    const acts = entry.category ? (data.actCounts.get(entry.category) ?? 0) : 0;
    const locked = this.busy || this.editing !== null;
    const plannedTitle = prediction
      ? `Geplant: ${formatDateTime(prediction.planned_start)} – ${formatDateTime(prediction.planned_end)}`
      : "";
    return html`<tr
      class=${classMap({
        current: status === "started",
        muted: status === "ended",
      })}
    >
      <td class="num muted">${index + 1}</td>
      <td>${this.renderStatus(entry)}</td>
      <td>
        ${
          entry.earliest_start_time
            ? formatDateTime(entry.earliest_start_time)
            : html`<span class="muted">–</span>`
        }
      </td>
      <td title=${plannedTitle || nothing}>
        ${prediction ? formatDateTime(prediction.predicted_start) : ""}
      </td>
      <td title=${plannedTitle || nothing}>
        ${prediction ? formatDateTime(prediction.predicted_end) : ""}
      </td>
      <td class="wrap">${this.renderEntry(data, entry)}</td>
      <td
        class=${classMap({ num: true, "text-warn": !!entry.category && !acts })}
        title=${
          entry.category && !acts
            ? "Keine Küren: der Block wird übersprungen"
            : nothing
        }
      >
        ${entry.category ? acts : ""}
      </td>
      <td
        class=${classMap({ num: true, muted: !!entry.category && !acts })}
        title=${duration.title || nothing}
      >
        ${duration.seconds === null ? "" : formatDuration(duration.seconds)}
      </td>
      <td class="actions">
        <button
          class="icon-btn"
          title="Nach oben"
          aria-label="Nach oben"
          data-id=${entry.id}
          ?disabled=${index === 0 || locked}
          @click=${this.onMoveUp}
        >
          arrow_upward
        </button>
        <button
          class="icon-btn"
          title="Nach unten"
          aria-label="Nach unten"
          data-id=${entry.id}
          ?disabled=${index === last || locked}
          @click=${this.onMoveDown}
        >
          arrow_downward
        </button>
        <button
          class="icon-btn primary"
          title=${this.editing ? "Erst speichern oder abbrechen" : "Bearbeiten"}
          aria-label="Bearbeiten"
          data-id=${entry.id}
          ?disabled=${locked}
          @click=${this.onEdit}
        >
          edit
        </button>
        <button
          class="icon-btn danger"
          title="Löschen"
          aria-label="Löschen"
          data-id=${entry.id}
          ?disabled=${locked}
          @click=${this.onDelete}
        >
          delete
        </button>
      </td>
    </tr>`;
  }

  private renderEditRow(data: Data, editing: Editing, index: number) {
    const { draft, original } = editing;
    const used = new Set(
      data.entries
        .filter((e) => e.id !== original?.id && e.category)
        .map((e) => e.category),
    );
    const available = [...data.categories.values()].filter(
      (c) => !used.has(c.name),
    );
    const custom = !draft.category;
    const duration = custom
      ? null
      : this.entryDuration(data, {
          id: original?.id ?? -1,
          category: draft.category,
        });
    const problems = this.draftProblems(editing, index);
    return html`<tr class="editing" @keydown=${this.onEditKeydown}>
      <td class="num muted">${original ? index + 1 : "neu"}</td>
      <td>${original ? this.renderStatus(original) : nothing}</td>
      <td>
        <input
          class=${classMap({ inline: true, invalid: problems.earliest })}
          type="datetime-local"
          aria-label="Frühester Start"
          title="Frühester Start (Ortszeit); leer lassen, um direkt nach dem vorherigen Eintrag zu beginnen"
          data-field="earliest"
          .value=${draft.earliest}
          @input=${this.onDraftInput}
        />
      </td>
      <td colspan="2" class="muted small">wird berechnet</td>
      <td>
        <div class="entry-edit">
          <select
            class="inline"
            aria-label="Eintrag"
            data-field="category"
            @change=${this.onDraftInput}
          >
            <option value="" ?selected=${custom}>Eigener Eintrag …</option>
            ${repeat(
              available,
              (c) => c.name,
              (c) =>
                html`<option
                  value=${c.name}
                  ?selected=${c.name === draft.category}
                >
                  ${c.name}${c.description ? ` – ${c.description}` : ""}
                </option>`,
            )}
          </select>
          ${
            custom
              ? html`<input
                  class=${classMap({
                    inline: true,
                    label: true,
                    invalid: problems.label,
                  })}
                  type="text"
                  placeholder="Bezeichnung, z. B. Mittagspause"
                  aria-label="Bezeichnung"
                  data-field="label"
                  .value=${draft.label}
                  @input=${this.onDraftInput}
                />`
              : nothing
          }
        </div>
      </td>
      <td class="num">
        ${custom ? "" : (data.actCounts.get(draft.category) ?? 0)}
      </td>
      <td class="num" title=${duration?.title || nothing}>
        ${
          custom
            ? html`<input
                class=${classMap({
                  inline: true,
                  num: true,
                  dur: true,
                  invalid: problems.duration,
                })}
                type="text"
                placeholder="m:ss"
                title="Dauer als m:ss oder in Sekunden"
                aria-label="Dauer"
                data-field="duration"
                .value=${draft.duration}
                @input=${this.onDraftInput}
              />`
            : !duration || duration.seconds === null
              ? ""
              : formatDuration(duration.seconds)
        }
      </td>
      <td class="actions">
        <button
          class="icon-btn ok"
          title="Speichern (Enter)"
          aria-label="Speichern"
          ?disabled=${this.busy}
          @click=${this.save}
        >
          check
        </button>
        <button
          class="icon-btn"
          title="Abbrechen (Esc)"
          aria-label="Abbrechen"
          ?disabled=${this.busy}
          @click=${this.cancelEdit}
        >
          close
        </button>
      </td>
    </tr>`;
  }

  /** Which fields of the draft are invalid; `index` is the row's position. */
  private draftProblems({ draft }: Editing, index: number) {
    const custom = !draft.category;
    const earliestInvalid =
      !!draft.earliest && toServerTime(draft.earliest) === null;
    return {
      // The prediction starts at the first entry's earliest start.
      earliestMissing: index === 0 && !draft.earliest,
      earliest: earliestInvalid || (index === 0 && !draft.earliest),
      earliestInvalid,
      label: custom && !draft.label.trim(),
      duration: custom && !parseDuration(draft.duration),
    };
  }

  private entryById(id: string | undefined) {
    return this.current?.entries.find((e) => String(e.id) === id);
  }

  private clearError() {
    this.error = "";
  }

  private reload() {
    this.data.run();
  }

  private dismissReloadError() {
    this.dismissedError = this.data.error;
  }

  private async focusEditRow() {
    await this.updateComplete;
    this.editEarliestInput?.focus();
  }

  private startNew() {
    this.error = "";
    this.editing = {
      original: null,
      draft: { earliest: "", category: "", label: "", duration: "" },
      earliestChanged: true,
    };
    this.focusEditRow();
  }

  private onEdit(e: Event) {
    const entry = this.entryById((e.currentTarget as HTMLElement).dataset.id);
    if (!entry) {
      return;
    }
    this.error = "";
    this.editing = {
      original: entry,
      draft: {
        earliest: toLocalInput(entry.earliest_start_time),
        category: entry.category ?? "",
        label: entry.label ?? "",
        duration:
          entry.duration_seconds === null ||
          entry.duration_seconds === undefined
            ? ""
            : formatDuration(entry.duration_seconds),
      },
      earliestChanged: false,
    };
    this.focusEditRow();
  }

  private cancelEdit() {
    this.editing = null;
    this.error = "";
  }

  private onDraftInput(e: Event) {
    if (!this.editing) {
      return;
    }
    const target = e.currentTarget as HTMLInputElement | HTMLSelectElement;
    const field = target.dataset.field as keyof EntryDraft;
    this.editing = {
      ...this.editing,
      draft: { ...this.editing.draft, [field]: target.value },
      earliestChanged: this.editing.earliestChanged || field === "earliest",
    };
  }

  private onEditKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      this.cancelEdit();
    } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      this.save();
    }
  }

  private async save() {
    const editing = this.editing;
    const data = this.current;
    if (!editing || !data || this.busy) {
      return;
    }
    const { draft, original } = editing;
    // By id: a poll may have reloaded the entries since editing started.
    const index = original
      ? data.entries.findIndex((e) => e.id === original.id)
      : data.entries.length;
    const problems = this.draftProblems(editing, index);
    const messages = [
      problems.earliestInvalid && "Die früheste Startzeit ist ungültig.",
      problems.earliestMissing &&
        "Der erste Eintrag braucht eine früheste Startzeit.",
      problems.label && "Bitte eine Bezeichnung eingeben.",
      problems.duration &&
        "Bitte eine Dauer als m:ss (z. B. 15:00) oder in Sekunden eingeben.",
    ].filter(Boolean);
    if (messages.length) {
      this.error = messages.join("\n");
      return;
    }

    const custom = !draft.category;
    // edit_timeplan_entry overwrites every field, so untouched fields are sent
    // back exactly as the server returned them.
    const body = {
      earliest_start_time: editing.earliestChanged
        ? toServerTime(draft.earliest)
        : (original?.earliest_start_time ?? null),
      category: draft.category || null,
      label: custom
        ? draft.label.trim()
        : original?.category
          ? (original.label ?? null)
          : null,
      duration_seconds: custom
        ? parseDuration(draft.duration)
        : original?.category
          ? (original.duration_seconds ?? null)
          : null,
    };
    this.busy = true;
    this.error = "";
    try {
      if (original) {
        unwrap(
          await client.POST("/api/command/edit_timeplan_entry", {
            body: { ...body, id: original.id },
          }),
        );
      } else {
        unwrap(await client.POST("/api/command/add_timeplan_entry", { body }));
      }
      this.editing = null;
      await this.data.run();
    } catch (error) {
      // Keep the row in edit mode, so nothing typed is lost.
      this.error = `Speichern fehlgeschlagen: ${errorMessage(error)}`;
    } finally {
      this.busy = false;
    }
  }

  private async onDelete(e: Event) {
    const entry = this.entryById((e.currentTarget as HTMLElement).dataset.id);
    const entries = this.current?.entries ?? [];
    if (!entry || this.busy) {
      return;
    }
    // Deleting the first entry makes the second one the first.
    const carry = entry === entries[0] ? carryOver(entries, entries[1]) : null;
    if (
      !confirm(
        `Zeitplan-Eintrag „${entryName(entry)}“ löschen?` +
          (carry
            ? `\n\n„${entryName(carry.entry)}“ wird der erste Eintrag und ` +
              `übernimmt die früheste Startzeit ${formatDateTime(carry.start)}.`
            : ""),
      )
    ) {
      return;
    }
    await this.command("Löschen fehlgeschlagen", async () => {
      await applyCarryOver(carry);
      unwrap(
        await client.POST("/api/command/delete_timeplan_entry", {
          body: { id: entry.id },
        }),
      );
    });
  }

  private async onMoveUp(e: Event) {
    const id = Number((e.currentTarget as HTMLElement).dataset.id);
    const entries = this.current?.entries ?? [];
    // Moving the second entry up makes it the first one.
    const carry = entries[1]?.id === id ? carryOver(entries, entries[1]) : null;
    await this.command("Verschieben fehlgeschlagen", async () => {
      await applyCarryOver(carry);
      unwrap(
        await client.POST("/api/command/move_timeplan_up", { body: { id } }),
      );
    });
  }

  private async onMoveDown(e: Event) {
    const id = Number((e.currentTarget as HTMLElement).dataset.id);
    const entries = this.current?.entries ?? [];
    // Moving the first entry down makes the second one the first.
    const carry = entries[0]?.id === id ? carryOver(entries, entries[1]) : null;
    await this.command("Verschieben fehlgeschlagen", async () => {
      await applyCarryOver(carry);
      unwrap(
        await client.POST("/api/command/move_timeplan_down", {
          body: { id },
        }),
      );
    });
  }

  /** Runs a command, then reloads; failures end up in the error banner. */
  private async command(failure: string, run: () => Promise<unknown>) {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.error = "";
    try {
      await run();
      await this.data.run();
    } catch (error) {
      this.error = `${failure}: ${errorMessage(error)}`;
    } finally {
      this.busy = false;
    }
  }
}
