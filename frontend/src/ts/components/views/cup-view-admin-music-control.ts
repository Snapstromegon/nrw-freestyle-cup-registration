import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, queryAll, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { errorMessage, PollController, unwrap } from "../../api";
import { client } from "../../apiClient";
import type { components } from "../../bindings";
import { type User, userContext } from "../../contexts/user";
import { adminStyles } from "../../styles/admin";
import { iconStyles, resetStyles } from "../../styles/base";
import {
  actParticipantsLabel,
  type CheckInMap,
  checkInMap,
  checkInStats,
  formatDuration,
  formatTime,
  isGroupActType,
  judgingAfterBlockEnd,
  lastTimeplanEntry,
  nextTimeplanEntry,
  normalizationLabel,
  songFile,
} from "../../utils";
import "../elements/cup-act-participants.js";
import "../elements/cup-timeplan.js";

type Act = components["schemas"]["Act"];
type Timeplan = components["schemas"]["Timeplan"];
type TimeplanItem = components["schemas"]["TimeplanItem"];
type TimeplanAct = components["schemas"]["TimeplanAct"];
type CategoryEntry = Extract<
  components["schemas"]["TimeplanEntry"],
  { Category: unknown }
>["Category"];

/** What is happening right now. */
type Phase =
  | "before"
  | "pause"
  | "done"
  | "warmup"
  | "act"
  | "judging"
  | "empty"
  | "custom";

const phaseLabels: Record<Phase, string> = {
  before: "Nicht gestartet",
  pause: "Pause",
  done: "Beendet",
  warmup: "Einfahrzeit",
  act: "Kür",
  judging: "Bewertung",
  empty: "Ohne Küren",
  custom: "Programmpunkt",
};

const phaseTones: Record<Phase, string> = {
  before: "muted",
  pause: "muted",
  done: "muted",
  warmup: "info",
  act: "ok",
  judging: "warn",
  empty: "muted",
  custom: "info",
};

interface NextAct {
  item: TimeplanItem;
  category: CategoryEntry;
  act: TimeplanAct;
}

interface Live {
  phase: Phase;
  /** The running timeplan entry. */
  entry?: TimeplanItem;
  /**
   * The block shown as the title: the running entry, or the block that just
   * ended while its last act is still being judged.
   */
  block?: TimeplanItem;
  category?: CategoryEntry;
  /** The running act, or the act being judged. */
  act?: TimeplanAct;
  /** The next act to start, possibly in a later block. */
  next?: NextAct;
  /** The next timeplan entry to start, if none is running. */
  nextEntry?: TimeplanItem;
  /** The last ended timeplan entry, if none is running. */
  lastEntry?: TimeplanItem;
  /** Start of the current phase and its planned length in seconds. */
  since?: string | null;
  plannedSeconds?: number;
}

const entryTitle = (item: TimeplanItem) =>
  "Category" in item.timeplan_entry
    ? item.timeplan_entry.Category.description
    : item.timeplan_entry.Custom.label;

const findNextAct = (timeplan: Timeplan): NextAct | undefined => {
  for (const item of timeplan.items) {
    if (item.status === "Ended" || !("Category" in item.timeplan_entry)) {
      continue;
    }
    const category = item.timeplan_entry.Category;
    const act = category.acts.find((a) => a.status === "Planned");
    if (act) {
      return { item, category, act };
    }
  }
  return undefined;
};

/**
 * Derives the live state the same way `timeplan_forward` sees it. `now` (ms)
 * decides whether the last act of an ended block is still being judged.
 */
const liveState = (timeplan: Timeplan, now: number): Live => {
  const next = findNextAct(timeplan);
  const entry = timeplan.items.find((item) => item.status === "Started");
  if (!entry) {
    // Skipped empty blocks are neither the last nor the next entry.
    const lastEntry = lastTimeplanEntry(timeplan);
    const nextEntry = nextTimeplanEntry(timeplan);
    // Ending the last act ends its block at once, but it is judged afterwards.
    const judging = judgingAfterBlockEnd(timeplan, now);
    if (judging) {
      return {
        phase: "judging",
        block: judging.entry,
        category: judging.category,
        act: judging.act,
        next,
        nextEntry,
        lastEntry,
        since: judging.act.ended_at,
        plannedSeconds: judging.category.judge_duration_seconds,
      };
    }
    return {
      phase: !lastEntry ? "before" : nextEntry ? "pause" : "done",
      next,
      nextEntry,
      lastEntry,
      since: lastEntry?.ended_at,
    };
  }
  if ("Custom" in entry.timeplan_entry) {
    return {
      phase: "custom",
      entry,
      block: entry,
      next,
      since: entry.started_at,
      plannedSeconds: entry.timeplan_entry.Custom.duration_seconds,
    };
  }
  const category = entry.timeplan_entry.Category;
  const running = category.acts.find((a) => a.status === "Started");
  if (running) {
    return {
      phase: "act",
      entry,
      block: entry,
      category,
      act: running,
      next,
      since: running.started_at,
      plannedSeconds: category.act_duration_seconds,
    };
  }
  const judged = category.acts.findLast((a) => a.status === "Ended");
  if (judged) {
    return {
      phase: "judging",
      entry,
      block: entry,
      category,
      act: judged,
      next,
      since: judged.ended_at,
      plannedSeconds: category.judge_duration_seconds,
    };
  }
  return {
    phase: category.acts.length ? "warmup" : "empty",
    entry,
    block: entry,
    category,
    next,
    since: entry.started_at,
    plannedSeconds: category.acts.length ? category.warmup_seconds : undefined,
  };
};

/**
 * How far the running plan is off, worded and coloured like the timeplan
 * view (/admin-timeplan): amber when behind, red from 15 minutes on.
 */
const scheduleOffset = (seconds: number) => ({
  label: seconds > 0 ? "Verzug" : seconds < 0 ? "Vorsprung" : "im Plan",
  value: formatDuration(Math.abs(seconds)),
  tone: seconds <= 0 ? "ok" : seconds <= 15 * 60 ? "warn" : "bad",
});

/** Lets a reload after a command release the buttons after this long. */
const RELOAD_TIMEOUT_MS = 5000;
/**
 * The control buttons stay disabled at least this long after a step, so the
 * second click of a double-click doesn't take another step.
 */
const MIN_BUSY_MS = 800;

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Live competition control: what is running, the music, who comes next
 * (with check-in state) and the buttons that move the timeplan on.
 */
@customElement("cup-view-admin-music-control")
export default class CupViewAdminMusicControl extends LitElement {
  static override styles = [
    resetStyles,
    iconStyles,
    adminStyles,
    css`
      :host {
        height: 100%;
        min-height: 0;
      }

      #wrapper {
        display: grid;
        grid-template-columns: minmax(20rem, 1.2fr) minmax(0, 3fr);
        grid-template-rows: auto minmax(0, 1fr);
        grid-template-areas: "overview main" "next main";
        height: 100%;
      }

      /* ---------- Left column ---------- */

      #overview {
        grid-area: overview;
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: baseline;
        gap: 0 0.75rem;
        padding: 0.375rem 0.75rem;
        border-right: 1px solid var(--cup-border);
        border-bottom: 1px solid var(--cup-border);
        background: var(--cup-surface-2);
      }

      #overview .label {
        color: var(--cup-muted);
        font-weight: 600;
      }

      #overview .delay {
        font-size: 1.9em;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        line-height: 1.15;
      }

      #overview.ok .delay {
        color: var(--tone-ok-fg);
      }

      #overview.warn {
        background: var(--tone-warn-bg);
      }

      #overview.warn .delay {
        color: var(--tone-warn-fg);
      }

      #overview.bad {
        background: var(--tone-bad-bg);
      }

      #overview.bad .delay {
        color: var(--tone-bad-fg);
      }

      #overview .facts {
        grid-column: 1 / -1;
        color: var(--cup-muted);
      }

      #next {
        grid-area: next;
        display: flex;
        flex-direction: column;
        min-height: 0;
        border-right: 1px solid var(--cup-border);
      }

      #next h2 {
        margin: 0;
        padding: 2px 6px;
        border-bottom: 1px solid var(--cup-border);
        font-size: 1em;
      }

      cup-timeplan {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
      }

      /* ---------- Main ---------- */

      main {
        grid-area: main;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        min-height: 0;
        padding: 0.5rem 0.75rem;
      }

      .status {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.25rem 0.75rem;
      }

      .status h1 {
        margin: 0;
        font-size: 1.6em;
      }

      .status .chip {
        font-size: 13px;
        line-height: 20px;
        padding: 0 0.6em;
      }

      .status .timer {
        font-size: 1.3em;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .status .timer.over {
        color: var(--tone-bad-fg);
      }

      .current {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .big {
        color: var(--cup-blue);
        font-size: 2.4em;
        font-weight: 700;
        line-height: 1.15;
      }

      /* Group name, counts and clubs, then the members in columns. */
      cup-act-participants.group {
        font-size: 2em;
      }

      .current .error-banner,
      .current .warn-banner,
      .next-card .error-banner,
      .next-card .warn-banner {
        font-size: 1.15em;
        font-weight: 650;
      }

      .current .error-banner {
        font-size: 1.4em;
        border-left-width: 8px;
      }

      /* Missing riders: each name is a button that checks the rider in. */
      .missing {
        flex-wrap: wrap;
        align-items: center;
        gap: 0.25rem 0.375rem;
      }

      .missing .btn {
        padding: 0 0.4em;
        border-color: color-mix(in srgb, currentColor 45%, transparent);
        color: inherit;
        font-weight: inherit;
        white-space: normal;
        text-align: left;
      }

      .missing .btn .material-icon {
        font-size: 1.1em;
      }

      .missing .btn.all {
        font-size: 0.8em;
      }

      .act-title {
        margin: 0;
        font-size: 1.3em;
      }

      .description {
        white-space: pre-line;
        color: var(--cup-muted);
      }

      .song {
        font-size: 1.1em;
      }

      .song .file {
        font-weight: 600;
        overflow-wrap: anywhere;
      }

      audio {
        width: 100%;
        min-height: 2.5rem;
      }

      .placeholder {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        color: var(--cup-muted);
        font-size: 1.2em;
      }

      .next-card {
        flex: none;
        max-height: 40%;
        overflow: auto;
        padding: 0.375rem 0.625rem;
        border: 1px solid var(--cup-border);
        border-left: 6px solid var(--cup-blue-2);
        border-radius: 4px;
        background: var(--cup-surface-2);
      }

      .next-card.warn {
        border-color: var(--cup-amber);
      }

      .next-card.bad {
        border-color: var(--cup-red);
        background: var(--tone-bad-bg);
      }

      .next-card header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.125rem 0.5rem;
        margin-bottom: 0.25rem;
      }

      .next-card header b {
        color: var(--cup-blue);
        font-size: 1.1em;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .next-card cup-act-participants {
        font-size: 1.35em;
      }

      .next-card .error-banner,
      .next-card .warn-banner {
        margin-bottom: 0;
      }

      .controls {
        flex: none;
        display: grid;
        grid-template-columns: minmax(8rem, 1fr) minmax(0, 3fr);
        gap: 0.5rem;
      }

      .controls .btn {
        justify-content: center;
        min-width: 0;
        min-height: 3.25rem;
        padding: 0.375rem 1rem;
        font-size: 1.25em;
        font-weight: 650;
      }

      .controls .btn .material-icon {
        font-size: 1.5em;
      }

      .controls .btn .label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .error-banner .icon-btn {
        color: inherit;
      }

      @media (max-width: 900px) {
        #wrapper {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto auto auto;
          grid-template-areas: "overview" "main" "next";
          /* Rows as tall as their content; the view scrolls instead. */
          align-content: start;
          overflow: auto;
        }

        #overview,
        #next {
          border-right: none;
        }

        #next {
          max-height: 60dvh;
        }

        /* Grid rows may not shrink below their content here. */
        main {
          min-height: auto;
        }

        .current,
        .next-card {
          flex: none;
          max-height: none;
          overflow: visible;
        }

        /* Let long "Weiter: …" labels wrap instead of cutting them off. */
        .controls .btn {
          white-space: normal;
        }

        .controls .btn .label {
          overflow: visible;
          overflow-wrap: anywhere;
        }
      }

      /* Phones: names are one line each, so they must fit the width. */
      @media (max-width: 600px) {
        .big {
          font-size: 1.4em;
        }

        cup-act-participants.group {
          font-size: 1.4em;
        }

        .next-card cup-act-participants {
          font-size: 1.15em;
        }
      }
    `,
  ];

  @consume({ context: userContext, subscribe: true })
  user: User | null = null;

  @state() private timeplan?: Timeplan;
  @state() private acts?: Act[];
  @state() private checkIns?: CheckInMap;
  @state() private loadErrors: string[] = [];
  @state() private commandError = "";
  /** Acts whose original song is played instead of the normalized copy. */
  @state() private originalSongs = new Set<string>();
  @state() private busy = false;
  /** Riders being checked in from a "nicht eingecheckt" banner. */
  @state() private checkingIn: ReadonlySet<string> = new Set();
  /** The reload after a step timed out; the view may predate the step. */
  @state() private stale = false;
  @state() private now = Date.now();
  @state() private loaded = false;
  @state() private initialized = false;

  @queryAll("audio") private audios!: NodeListOf<HTMLAudioElement>;

  private actsById = new Map<string, Act>();
  private lastJson: Record<string, string> = {};
  private loadSeq = 0;
  private appliedSeq = 0;
  /** The first load that started after the last timeplan step. */
  private reloadSeq = 0;
  /** The load whose timeplan is shown. */
  private timeplanSeq = 0;

  poll = new PollController(this, 3000, (signal) => this.load(signal));
  // Ticks the phase timer.
  clock = new PollController(this, 1000, () => {
    this.now = Date.now();
  });

  override updated(changed: Map<PropertyKey, unknown>) {
    super.updated(changed);
    if (this.user && !this.initialized) {
      this.initialized = true;
      this.load();
    }
  }

  override connectedCallback() {
    super.connectedCallback?.();
    window.addEventListener("beforeunload", this.onBeforeUnload);
    this.load();
  }

  override disconnectedCallback() {
    super.disconnectedCallback?.();
    window.removeEventListener("beforeunload", this.onBeforeUnload);
  }

  /**
   * Every admin link (nav, Check-In, logout) loads a new page, which would
   * stop the music; while it plays, the browser asks first.
   */
  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    const playing = [...this.audios].some(
      (audio) => !audio.paused && !audio.ended,
    );
    if (playing) {
      e.preventDefault();
      // For browsers that ignore preventDefault() here.
      e.returnValue = true;
    }
  };

  /** Loads timeplan, acts and check-ins; unchanged data isn't re-rendered. */
  private async load(signal?: AbortSignal) {
    // The admin shell shows "Kein Zugriff" instead; don't poll in vain.
    if (!this.user?.is_admin) {
      return;
    }
    const seq = ++this.loadSeq;
    const [timeplan, acts, checkIns] = await Promise.allSettled([
      client
        .GET("/api/query/predict_timeplan", { signal })
        .then((r) => unwrap(r)),
      client.GET("/api/query/list_acts", { signal }).then((r) => unwrap(r)),
      client
        .GET("/api/query/list_check_ins", { signal })
        .then((r) => unwrap(r)),
    ]);
    // A slow, older poll must not overwrite the state after a command.
    if (seq < this.appliedSeq) {
      return;
    }
    this.appliedSeq = seq;
    const errors: string[] = [];
    if (timeplan.status === "fulfilled") {
      if (this.changed("timeplan", timeplan.value)) {
        this.timeplan = timeplan.value;
      }
      this.timeplanSeq = seq;
      if (seq >= this.reloadSeq) {
        this.stale = false;
      }
    } else {
      errors.push(`Zeitplan: ${errorMessage(timeplan.reason)}`);
    }
    if (acts.status === "fulfilled") {
      if (this.changed("acts", acts.value)) {
        this.acts = acts.value;
        this.actsById = new Map(acts.value.map((act) => [act.id, act]));
      }
    } else {
      errors.push(`Küren: ${errorMessage(acts.reason)}`);
    }
    if (checkIns.status === "fulfilled") {
      if (this.changed("checkIns", checkIns.value)) {
        this.checkIns = checkInMap(checkIns.value);
      }
    } else {
      errors.push(`Check-In: ${errorMessage(checkIns.reason)}`);
    }
    if (errors.join("\n") !== this.loadErrors.join("\n")) {
      this.loadErrors = errors;
    }
    this.loaded = true;
  }

  private changed(key: string, value: unknown) {
    const json = JSON.stringify(value);
    if (this.lastJson[key] === json) {
      return false;
    }
    this.lastJson[key] = json;
    return true;
  }

  override render() {
    const live = this.timeplan ? liveState(this.timeplan, this.now) : undefined;
    return html`<div id="wrapper">
      ${this.renderOverview()}
      <aside id="next">
        <h2>Zeitplan</h2>
        <cup-timeplan
          is-admin
          dense
          .timeplan=${this.timeplan}
          .acts=${this.acts ?? null}
          .checkIns=${this.checkIns ?? null}
        ></cup-timeplan>
      </aside>
      <main>
        ${this.renderErrors()}
        ${
          live
            ? html`${this.renderStatus(live)}
              <section class="current">${this.renderCurrent(live)}</section>
              ${this.renderNext(live)}`
            : html`<section class="current placeholder">
              ${this.loaded ? "Kein Zeitplan geladen." : "Lade …"}
            </section>`
        }
        ${this.renderControls(live)}
      </main>
    </div>`;
  }

  private renderOverview() {
    const timeplan = this.timeplan;
    const offset = timeplan ? scheduleOffset(timeplan.offset) : undefined;
    const last = timeplan?.items.at(-1);
    return html`<aside id="overview" class=${offset?.tone ?? ""}>
      <span class="label">${offset?.label ?? "Verzug"}</span>
      <span class="delay" title="Abweichung vom geplanten Ablauf"
        >${offset?.value ?? "–"}</span
      >
      <span class="facts">
        Jetzt
        ${formatTime(new Date(this.now))}${
          last
            ? html` · Ende ca. ${formatTime(last.predicted_end)}
              <span class="small"
                >(geplant ${formatTime(last.planned_end)})</span
              >`
            : nothing
        }
      </span>
    </aside>`;
  }

  private renderErrors() {
    return html`${
      this.stale
        ? html`<div class="warn-banner" role="status">
          Keine Antwort vom Server – die Anzeige ist evtl. noch vom letzten
          Schritt. Vor dem nächsten Schritt die Aktualisierung abwarten.
        </div>`
        : nothing
    }
    ${
      this.loadErrors.length
        ? html`<div class="error-banner" role="alert">
          ${this.loadErrors.join("\n")}
        </div>`
        : nothing
    }
    ${
      this.commandError
        ? html`<div class="error-banner" role="alert">
          <span>${this.commandError}</span>
          <button
            class="icon-btn"
            title="Schließen"
            aria-label="Schließen"
            @click=${this.clearCommandError}
          >
            close
          </button>
        </div>`
        : nothing
    }`;
  }

  private renderStatus(live: Live) {
    const title = live.block
      ? entryTitle(live.block)
      : live.phase === "before"
        ? "Wettbewerb noch nicht gestartet"
        : live.phase === "done"
          ? "Zeitplan beendet"
          : "Pause";
    const position =
      live.category && live.act
        ? `Kür ${live.category.acts.indexOf(live.act) + 1} von ${live.category.acts.length}`
        : // Empty blocks: the "Ohne Küren" chip says it already.
          live.category?.acts.length
          ? `${live.category.acts.length} ${
              live.category.acts.length === 1 ? "Kür" : "Küren"
            }`
          : "";
    return html`<div class="status">
      <h1>${title}</h1>
      ${
        // Without a block the title already names the phase.
        live.block
          ? html`<span class="chip ${phaseTones[live.phase]}"
              >${phaseLabels[live.phase]}</span
            >`
          : nothing
      }
      ${position ? html`<span class="muted">${position}</span>` : nothing}
      ${this.renderTimer(live)}
    </div>`;
  }

  private renderTimer(live: Live) {
    if (!live.since) {
      return nothing;
    }
    const elapsed = Math.max(
      0,
      (this.now - new Date(live.since).getTime()) / 1000,
    );
    const planned = live.plannedSeconds;
    if (!planned) {
      return html`<span class="timer muted" title="Dauer bisher"
        >seit ${formatDuration(elapsed)}</span
      >`;
    }
    return html`<span
      class=${classMap({ timer: true, over: elapsed > planned })}
      title="Dauer bisher / geplant"
      >${formatDuration(elapsed)} / ${formatDuration(planned)}</span
    >`;
  }

  private renderCurrent(live: Live) {
    const act = live.act ? this.actsById.get(live.act.id) : undefined;
    if (!live.act) {
      return this.renderPlaceholder(live);
    }
    if (!act) {
      return html`<div class="big">${live.act.name || "Kür"}</div>`;
    }
    const group = isGroupActType(act.act_type);
    // The player comes first, so a large group can't push it out of view.
    // It keeps its place in this template in both phases, so the playing
    // element isn't recreated when the act ends.
    const file = songFile(act, this.originalSongs.has(act.id));
    return html`${this.renderSong(act)}
      ${
        file
          ? keyed(
              `${file}|${act.song_file_name ?? ""}`,
              html`<audio
              controls
              preload="auto"
              src="/songs/${file}"
            ></audio>`,
            )
          : nothing
      }
      ${
        live.phase === "judging"
          ? html`<div class="muted">Wird bewertet:</div>`
          : nothing
      }
      <cup-act-participants
        class=${group ? "group" : "big"}
        layout="list"
        .act=${act}
        .checkIns=${this.checkIns ?? null}
      ></cup-act-participants>
      ${
        live.phase === "act"
          ? this.renderMissing(act, "Nicht eingecheckt")
          : nothing
      }
      ${act.name ? html`<h2 class="act-title">${act.name}</h2>` : nothing}
      ${
        act.description
          ? html`<p class="description">${act.description}</p>`
          : nothing
      }`;
  }

  /** Phases without an act; the status line above already names them. */
  private renderPlaceholder(live: Live) {
    switch (live.phase) {
      case "warmup":
        return html`<div class="placeholder">
          <div class="big">Einfahrzeit</div>
        </div>`;
      case "empty":
        return html`<div class="placeholder">
          <div class="big">Keine Küren</div>
          <span
            >Dieser Block hat keine Küren und wird mit „Weiter“ beendet.</span
          >
        </div>`;
      case "custom":
        return live.entry
          ? html`<div class="placeholder">
              <span
                >Geplant bis ca. ${formatTime(live.entry.predicted_end)}</span
              >
            </div>`
          : nothing;
      case "done":
        return nothing;
      default: {
        const nextEntry = live.nextEntry;
        return nextEntry
          ? html`<div class="placeholder">
              <span
                >Als Nächstes: <b>${entryTitle(nextEntry)}</b>, ca.
                ${formatTime(nextEntry.predicted_start)}
                <span class="small"
                  >(geplant ${formatTime(nextEntry.planned_start)})</span
                ></span
              >
            </div>`
          : nothing;
      }
    }
  }

  private renderNext(live: Live) {
    const next = live.next;
    if (!next) {
      // E.g. the award ceremony after the last block.
      const after = this.timeplan && nextTimeplanEntry(this.timeplan);
      return html`<section class="next-card">
        <header>
          <b>Als Nächstes</b
          ><span class="muted"
            >Keine weitere Kür geplant${
              after
                ? html` · danach ${entryTitle(after)}, ca.
                  ${formatTime(after.predicted_start)}`
                : nothing
            }</span
          >
        </header>
      </section>`;
    }
    const act = this.actsById.get(next.act.id);
    const stats =
      act && this.checkIns
        ? checkInStats(act.participants, this.checkIns)
        : null;
    const regularMissing = !!stats?.missing.some((p) => !p.is_replacement);
    const otherBlock = next.item !== live.entry;
    // Breaks etc. that come before the next act.
    const between =
      this.timeplan?.items.filter(
        (item, index, items) =>
          item.status === "Planned" &&
          "Custom" in item.timeplan_entry &&
          index < items.indexOf(next.item),
      ) ?? [];
    const betweenLabels = between.map(entryTitle).join(", ");
    return html`<section
      class=${classMap({
        "next-card": true,
        bad: regularMissing,
        warn: !!stats?.missing.length && !regularMissing,
      })}
    >
      <header>
        <b>Als Nächstes</b>
        <span
          >${otherBlock ? html`${next.category.description} · ` : nothing}ca.
          ${formatTime(next.act.predicted_start)}</span
        >
        ${
          betweenLabels
            ? html`<span class="muted">vorher: ${betweenLabels}</span>`
            : nothing
        }
        ${act ? this.renderSongChip(act) : nothing}
      </header>
      ${
        act
          ? html`<cup-act-participants
              layout="list"
              .act=${act}
              .checkIns=${this.checkIns ?? null}
            ></cup-act-participants>
            ${this.renderMissing(act, "Bitte aufrufen – nicht eingecheckt")}`
          : html`<div>${next.act.name}</div>`
      }
    </section>`;
  }

  /**
   * Red banner for missing riders, amber if only replacements are missing.
   * A click on a name checks that rider in, so nobody has to leave the page
   * (and stop the music) for the check-in view.
   */
  private renderMissing(act: Act, label: string) {
    if (!this.checkIns) {
      return nothing;
    }
    const stats = checkInStats(act.participants, this.checkIns);
    if (!stats.missing.length) {
      return nothing;
    }
    const regularMissing = stats.missing.some((p) => !p.is_replacement);
    const allIds = stats.missing.map((p) => p.id);
    const names = new Map(
      stats.missing.map((p, i) => [p.id, stats.missingNames[i]]),
    );
    return html`<div
      class="missing ${regularMissing ? "error-banner" : "warn-banner"}"
      role="alert"
    >
      <span>${label}:</span>
      ${repeat(
        stats.missing,
        (p) => p.id,
        (p) =>
          html`<button
            class="btn"
            title="${names.get(p.id)} einchecken"
            data-ids=${p.id}
            data-label=${names.get(p.id) ?? ""}
            ?disabled=${this.checkingIn.has(p.id)}
            @click=${this.onCheckInClick}
          >
            <span class="material-icon" aria-hidden="true">how_to_reg</span
            >${names.get(p.id)}
          </button>`,
      )}
      ${
        allIds.length > 1
          ? html`<button
              class="btn all"
              title="Alle ${allIds.length} einchecken"
              data-ids=${allIds.join(",")}
              data-label=${stats.missingNames.join(", ")}
              ?disabled=${allIds.every((id) => this.checkingIn.has(id))}
              @click=${this.onCheckInClick}
            >
              Alle einchecken
            </button>`
          : nothing
      }
    </div>`;
  }

  private onCheckInClick(e: Event) {
    const { ids, label } = (e.currentTarget as HTMLElement).dataset;
    if (ids) {
      this.checkIn(ids.split(","), label ?? "");
    }
  }

  /** Checks riders in from a banner; errors go to the command error. */
  private async checkIn(ids: string[], names: string) {
    this.checkingIn = new Set([...this.checkingIn, ...ids]);
    try {
      unwrap(
        await client.POST("/api/command/set_checked_in", {
          body: { starter_ids: ids, checked_in: true },
        }),
      );
      await this.reload();
    } catch (error) {
      this.commandError = `Einchecken von ${names} fehlgeschlagen: ${errorMessage(error)}`;
    } finally {
      const pending = new Set(this.checkingIn);
      for (const id of ids) {
        pending.delete(id);
      }
      this.checkingIn = pending;
    }
  }

  private renderSong(act: Act) {
    return html`<div class="song row">
      <span class="material-icon inline" aria-hidden="true"
        >${act.song_file ? "music_note" : "music_off"}</span
      >
      <span class="file"
        >${
          act.song_file_name || act.song_file || "Keine Musik hochgeladen"
        }</span
      >
      ${this.renderSongChip(act)}
      ${
        act.song_file_normalized
          ? html`<label
              class="small"
              title="Das Original statt der Version mit angeglichener Lautstärke abspielen"
              ><input
                type="checkbox"
                .checked=${this.originalSongs.has(act.id)}
                data-id=${act.id}
                @change=${this.onOriginalChange}
              />
              Original</label
            >`
          : act.normalization_status === "failed"
            ? html`<span
                class="chip warn"
                title=${normalizationLabel(act.normalization_status)}
                >Original</span
              >`
            : nothing
      }
    </div>`;
  }

  private onOriginalChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const id = input.dataset.id ?? "";
    const next = new Set(this.originalSongs);
    if (input.checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    this.originalSongs = next;
  }

  private renderSongChip(act: Act) {
    return !act.song_file
      ? html`<span class="chip bad">keine Musik</span>`
      : act.song_checked
        ? html`<span class="chip ok">Musik geprüft</span>`
        : html`<span class="chip warn">Musik ungeprüft</span>`;
  }

  private renderControls(live?: Live) {
    const forward = live ? this.forwardLabel(live) : null;
    const backward = live ? this.backwardLabel(live) : null;
    return html`<div class="controls">
      <button
        class="btn"
        ?disabled=${this.busy || !backward}
        title=${backward ? `Zurück: ${backward}` : "Nichts zurückzunehmen"}
        @click=${this.timeplanBackward}
      >
        <span class="material-icon" aria-hidden="true">undo</span>
        <span class="label">Zurück</span>
      </button>
      <button
        class="btn primary"
        ?disabled=${this.busy || !forward}
        title=${forward ?? "Der Zeitplan ist beendet"}
        @click=${this.timeplanForward}
      >
        <span class="label"
          >${forward ? `Weiter: ${forward}` : "Zeitplan beendet"}</span
        >
        <span class="material-icon" aria-hidden="true">arrow_forward</span>
      </button>
    </div>`;
  }

  /** Who performs an act: the group name or the riders' names. */
  private actLabel(timeplanAct: TimeplanAct) {
    const act = this.actsById.get(timeplanAct.id);
    return (act && actParticipantsLabel(act)) || timeplanAct.name || "Kür";
  }

  /** What `timeplan_forward` will do next, or null if nothing is left. */
  private forwardLabel(live: Live): string | null {
    // Nothing is running: the next entry starts.
    if (!live.entry) {
      const nextEntry = live.nextEntry;
      if (!nextEntry) {
        return null;
      }
      if ("Custom" in nextEntry.timeplan_entry) {
        return `Start ${nextEntry.timeplan_entry.Custom.label}`;
      }
      // Empty blocks before it are skipped in the same step.
      const next = nextEntry.timeplan_entry.Category;
      const first = next.acts.find((a) => a.status === "Planned");
      if (next.warmup_seconds > 0) {
        return `Einfahrzeit ${next.description}`;
      }
      return first
        ? `Start ${this.actLabel(first)}`
        : `Start ${next.description}`;
    }
    const acts = live.category?.acts ?? [];
    switch (live.phase) {
      case "custom":
        return `${entryTitle(live.entry)} beenden`;
      case "empty":
        return `${entryTitle(live.entry)} beenden (keine Küren)`;
      case "act":
        return acts.some((a) => a.status === "Planned")
          ? "Bewertung"
          : "Bewertung (Blockende)";
      default: {
        const next = acts.find((a) => a.status === "Planned");
        return next ? `Start ${this.actLabel(next)}` : "Block beenden";
      }
    }
  }

  /** What `timeplan_backward` will undo, or null if nothing has started. */
  private backwardLabel(live: Live): string | null {
    switch (live.phase) {
      case "before":
        return null;
      case "pause":
      case "done": {
        const last = live.lastEntry;
        if (!last) {
          return null;
        }
        if ("Category" in last.timeplan_entry) {
          const lastAct = last.timeplan_entry.Category.acts.at(-1);
          return lastAct
            ? `„${this.actLabel(lastAct)}“ läuft wieder`
            : `„${entryTitle(last)}“ läuft wieder`;
        }
        return `„${entryTitle(last)}“ läuft wieder`;
      }
      case "act":
        return live.act
          ? `Start von „${this.actLabel(live.act)}“ zurücknehmen`
          : null;
      case "judging":
        return live.act ? `„${this.actLabel(live.act)}“ läuft wieder` : null;
      case "custom":
      case "warmup":
      case "empty":
        return live.entry
          ? `Start von „${entryTitle(live.entry)}“ zurücknehmen`
          : null;
    }
  }

  private clearCommandError() {
    this.commandError = "";
  }

  async timeplanBackward() {
    const live = this.timeplan ? liveState(this.timeplan, this.now) : undefined;
    const label = live ? this.backwardLabel(live) : null;
    if (!label || !confirm(`Einen Schritt zurück?\n\n${label}`)) {
      return;
    }
    await this.runCommand(async () =>
      unwrap(await client.POST("/api/command/timeplan_backward")),
    );
  }

  async timeplanForward(e: MouseEvent) {
    // The second click of a double-click; keyboard activation has detail 0.
    if (e.detail > 1) {
      return;
    }
    await this.runCommand(async () =>
      unwrap(await client.POST("/api/command/timeplan_forward")),
    );
  }

  /**
   * Reloads after a command. Requests that take longer than
   * `RELOAD_TIMEOUT_MS` are aborted (shown as a load error), so a dying
   * connection can't hold the buttons.
   */
  private reload() {
    return this.load(AbortSignal.timeout(RELOAD_TIMEOUT_MS));
  }

  /**
   * Runs a timeplan step and reloads. The buttons stay disabled until the
   * step is answered and for at least `MIN_BUSY_MS`; a hanging reload only
   * holds them for `RELOAD_TIMEOUT_MS`.
   */
  private async runCommand(command: () => Promise<unknown>) {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.commandError = "";
    const minBusy = delay(MIN_BUSY_MS);
    try {
      await command();
    } catch (error) {
      this.commandError = errorMessage(error);
    }
    try {
      // Only a load started from here on shows the state after the step.
      this.reloadSeq = this.loadSeq + 1;
      await this.reload();
      // Without a timeplan from after the step, the buttons may still offer
      // the step that was just taken. The next poll that gets one clears it.
      this.stale = this.timeplanSeq < this.reloadSeq;
      await minBusy;
    } finally {
      this.busy = false;
    }
  }
}
