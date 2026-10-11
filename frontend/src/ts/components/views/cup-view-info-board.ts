import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { PollController, unwrap } from "../../api";
import { client, type components } from "../../apiClient";
import "../elements/cup-timeplan.js";
import "../elements/cup-clock.js";
import "../elements/cup-countdown.js";
import "../elements/cup-fotobox.js";
import {
  type SystemStatus,
  systemStatusContext,
} from "../../contexts/systemStatus";
import {
  actClubNames,
  actParticipantsLabel,
  competitionName,
  currentTimeplanAct,
  currentTimeplanEntry,
  isGroupActType,
  lastTimeplanAct,
  lastTimeplanEntry,
  nextTimeplanEntry,
  participantName,
  TimeplanStatus,
  timeplanStatus,
} from "../../utils";

type Act = components["schemas"]["Act"];
type Timeplan = components["schemas"]["Timeplan"];
type TimeplanItem = components["schemas"]["TimeplanItem"];

/** The description of a timeplan item's category, if it is one. */
const categoryDescription = (item: TimeplanItem | undefined) =>
  item && "Category" in item.timeplan_entry
    ? item.timeplan_entry.Category.description
    : nothing;

@customElement("cup-view-info-board")
export default class CupViewInfoBoard extends LitElement {
  @consume({ context: systemStatusContext, subscribe: true })
  systemStatus: SystemStatus | null = null;

  static override styles = css`
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: "Mona Sans";
    }
    #wrapper {
      display: grid;
      grid-template-columns: 1fr 3fr;
      grid-template-rows: 1fr auto;
      grid-template-areas: "aside main" "aside footer";
      height: 100dvh;
      overflow: hidden;
      gap: 5vh;
      background: radial-gradient(
        circle at center,
        #002d56 0.1vh,
        #002d5600 0.1vh
      );
      background-size: 5vh 5vh;
      background-repeat: repeat;
    }

    footer {
      grid-area: footer;
      display: flex;
      justify-content: space-evenly;
      padding: 1rem;

      img {
        height: 7vh;
      }
    }

    aside {
      display: grid;
      grid-template-columns: 3fr 2fr;
      grid-template-rows: auto auto 1fr;
      grid-template-areas: "title title" "logo qrcode" "timeplan timeplan";
      gap: 3dvh 0;
      padding-top: 3dvh;
      background: #002d56;
      color: #fff;
      align-items: center;
      position: relative;
      height: 100%;
      grid-area: aside;

      h1 {
        font-size: 5dvh;
        text-align: center;
        font-family: "Andy", sans-serif;
        grid-area: title;
        text-wrap: balance;
      }

      cup-timeplan {
        overflow: hidden;
        flex-shrink: 1;
        width: 100%;
        height: 100%;
        grid-area: timeplan;
      }

      &::after {
        content: "";
        display: block;
        position: absolute;
        left: 0;
        bottom: 0;
        height: 25vh;
        width: 100%;
        background: linear-gradient(to top, #002d56, #002d5600);
      }

      &::before {
        content: "";
        display: block;
        position: absolute;
        left: 100%;
        top: 0;
        height: 100%;
        width: 10vh;
        background: #002d56;
        --size: 5vh;
        --m: 2;
        --R: calc(var(--size) * sqrt(var(--m) * var(--m) + 1));

        mask:
          radial-gradient(
              var(--R) at calc(-1 * var(--size) * var(--m)) 50%,
              #000 99.8%,
              #0000 100.2%
            )
            0% calc(50% - 2 * var(--size)) / 50% calc(4 * var(--size)),
          radial-gradient(
              var(--R) at calc(var(--size) * (1 + var(--m))) 50%,
              #0000 99.8%,
              #000 100.2%
            )
            0 50% / 50% calc(4 * var(--size)) repeat-y;
      }

      #qrcode {
        grid-area: qrcode;
        place-self: center;
        img {
          height: 15dvh;
        }
        h2 {
          text-align: center;
          margin-bottom: 1vh;
        }
      }
    }

    #logo {
      grid-area: logo;
      height: 20dvh;
      place-self: center;
    }

    main {
      min-height: 0;
      min-width: 0;
      grid-area: main;
      padding: 10vh;
      padding-bottom: 0;
      align-self: center;
      position: relative;
      width: 100%;
      height: 100%;
      img#fallback {
        width: 50vh;
      }

      .break,
      .warmup,
      .award,
      .act {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5vh;
        text-align: center;
        justify-content: center;
        height: 100%;
        width: 100%;

        & h1 {
          font-size: 10vh;
        }
        & h2 {
          font-size: 6vh;
        }
        & h3 {
          font-size: 4vh;
        }
      }

      .act {
        gap: 10vh;
        & h1 {
          font-size: 8vh;
        }

        & h2 {
          font-size: 6vh;
        }

        & h3 {
          font-size: 3vh;
        }
      }
    }

    main .break {
      gap: 1vh;
    }

    .judging {
      display: grid;
      grid-template-columns: 50% 50%;
      text-align: center;
      gap: 3vh;
      height: 100%;
      width: 100%;
      animation: show-judge-image 1s;

      &:has(cup-fotobox[invisible]) {
        grid-template-columns: 25% 50% 25%;
        animation: none;
      }

      & cup-fotobox {
        animation: show-judge-image-inside 1s;
      }

      & section {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5vh;
        text-align: center;
        grid-column: 2 / 3;
      }

      & h1 {
        font-size: 8vh;
      }

      & h2 {
        font-size: 5vh;
      }

      & h3 {
        font-size: 3vh;
      }
    }

    .starters {
      display: flex;
      flex-direction: row;
      display: grid;
      grid-auto-columns: 1fr;
      grid-auto-flow: column;
      align-items: center;
      gap: 10vh;
      text-align: center;
    }

    .starter.group h3 {
      text-wrap: balance;
    }

    cup-fotobox {
      min-height: 0;
      width: 100%;
    }

    @keyframes show-judge-image-inside {
      from {
        opacity: 0;
        display: none;
      }
      49.9999% {
        opacity: 0;
        display: none;
      }
      50% {
        opacity: 0;
        display: block;
      }
      to {
        opacity: 1;
        display: block;
      }
    }

    @keyframes show-judge-image {
      from {
        grid-template-columns: 25% 50% 25%;
      }
      50% {
        grid-template-columns: 50% 50% 0%;
      }
      to {
        grid-template-columns: 50% 50%;
      }
    }
  `;

  /** The last timeplan as JSON, to only re-render when it changed. */
  private lastRawTimeplan?: string;
  /** Which acts were shown (current and last) when `acts` was loaded. */
  private actsLoadedFor?: string;

  @state() predictedTimeplan?: Timeplan;
  /**
   * What the board shows. It is computed with every poll, because the
   * judging after a block's last act ends by time, without any change to the
   * timeplan.
   */
  @state() status?: TimeplanStatus;
  @state() acts = new Map<string, Act>();

  poll = new PollController(this, 1000, (signal) => this.refresh(signal));

  override connectedCallback() {
    super.connectedCallback?.();
    this.poll.runNow();
  }

  /**
   * Loads the timeplan. The acts are only reloaded when another act is shown,
   * which also picks up late changes (e.g. to a group's members).
   */
  async refresh(signal?: AbortSignal) {
    const timeplan = unwrap(
      await client.GET("/api/query/predict_timeplan", { signal }),
    );
    const shownActs = `${currentTimeplanAct(timeplan)?.id}/${lastTimeplanAct(timeplan)?.id}`;
    if (shownActs !== this.actsLoadedFor) {
      try {
        const acts = unwrap(
          await client.GET("/api/query/list_acts", { signal }),
        );
        this.acts = new Map(acts.map((act) => [act.id, act]));
        this.actsLoadedFor = shownActs;
      } catch (error) {
        // Keep showing the timeplan; the acts are retried with the next poll.
        console.error(error);
      }
    }
    const raw = JSON.stringify(timeplan);
    if (raw !== this.lastRawTimeplan) {
      this.predictedTimeplan = timeplan;
      this.lastRawTimeplan = raw;
    }
    const status = timeplanStatus(timeplan);
    if (status !== this.status) {
      this.status = status;
    }
  }

  /**
   * The riders of an act with their clubs. A group shows its name and clubs
   * instead, since tiles for 9 or more riders don't fit on the board.
   */
  renderPerformers(actId: string | undefined) {
    const act = actId ? this.acts.get(actId) : undefined;
    if (!act) {
      return nothing;
    }
    if (isGroupActType(act.act_type)) {
      return html`<div class="starters">
        <div class="starter group">
          <h2>${actParticipantsLabel(act)}</h2>
          <h3>${actClubNames(act).join(" · ")}</h3>
        </div>
      </div>`;
    }
    return html`<div class="starters">
      ${repeat(
        act.participants,
        (p) => p.id,
        (p) => html`
          <div class="starter">
            <h2>${participantName(p)}</h2>
            <h3>${p.club_name}</h3>
          </div>
        `,
      )}
    </div>`;
  }

  renderMain() {
    if (!this.predictedTimeplan) {
      return html`<div class="break">
        <cup-fotobox
          src="/assets/images/logo_with_blobs.svg"
          auto-reload
        ></cup-fotobox>
        <cup-clock></cup-clock>
      </div>`;
    }
    const timeplan = this.predictedTimeplan;
    const status = this.status ?? timeplanStatus(timeplan);
    const currentEntry = currentTimeplanEntry(timeplan);
    const currentAct = currentTimeplanAct(timeplan);
    // A block's last act is judged after the block has ended; the act and its
    // block are then the last ended ones.
    const lastAct = lastTimeplanAct(timeplan);
    const lastEntry = lastTimeplanEntry(timeplan);
    const nextEntry = nextTimeplanEntry(timeplan);
    switch (status) {
      case TimeplanStatus.Break:
        return html`<div class="break">
          <cup-fotobox
            src=${
              lastEntry
                ? "http://nrw-cup-fotos:8080/random"
                : "/assets/images/logo_with_blobs.svg"
            }
            auto-reload
          ></cup-fotobox>
          <cup-clock></cup-clock>
        </div>`;
      case TimeplanStatus.Warmup:
        return html`<div class="warmup">
          <h1>Einfahrzeit</h1>
          <h2>${categoryDescription(currentEntry)}</h2>
          ${
            nextEntry &&
            "Category" in nextEntry.timeplan_entry &&
            nextEntry.timeplan_entry.Category.einfahrzeit_seconds === 0
              ? html`<h2>${nextEntry.timeplan_entry.Category.description}</h2>`
              : nothing
          }
          <cup-countdown
            .time=${new Date(
              new Date(currentEntry?.predicted_start || "").getTime() +
                (currentEntry && "Category" in currentEntry.timeplan_entry
                  ? currentEntry.timeplan_entry.Category.einfahrzeit_seconds *
                    1000
                  : 0),
            )}
          ></cup-countdown>
        </div>`;
      case TimeplanStatus.Act:
        return html`<div class="act">
          ${currentAct?.name ? html`<h1>${currentAct.name}</h1>` : nothing}
          ${this.renderPerformers(currentAct?.id)}
          <h3>${categoryDescription(currentEntry)}</h3>
        </div>`;
      case TimeplanStatus.Judging:
        return html`<div class="judging">
          <cup-fotobox
            src="http://nrw-cup-fotos:8080/newest?date=${Math.floor(
              Date.now() / 1000 / 60,
            )}"
          ></cup-fotobox>
          <section>
            <h3>Das war...</h3>
            ${lastAct?.name ? html`<h1>${lastAct.name}</h1>` : nothing}
            ${this.renderPerformers(lastAct?.id)}
            <h3>${categoryDescription(currentEntry ?? lastEntry)}</h3>
            <cup-clock></cup-clock>
          </section>
        </div>`;
      case TimeplanStatus.Award:
        return html`<div class="award">
          <img
            id="fallback"
            src="/assets/images/logo_with_blobs.svg"
            alt=${competitionName(this.systemStatus?.competition)}
          />
          <h1>Siegerehrung</h1>
        </div>`;
    }
    return nothing;
  }

  override render() {
    return html`
      <div id="wrapper">
        <aside>
          <h1>${competitionName(this.systemStatus?.competition)}</h1>
          <img
            id="logo"
            src="/assets/images/nrw-freestyle-cup.svg"
            alt=${competitionName(this.systemStatus?.competition)}
          />
          <div id="qrcode">
            <h2>Fotos</h2>
            <img
              src="/assets/images/qrcode-fotos.svg"
              alt="${competitionName(this.systemStatus?.competition)} Fotos QR Code"
            />
          </div>
          <cup-timeplan .timeplan=${this.predictedTimeplan}></cup-timeplan>
        </aside>
        <main>${this.renderMain()}</main>
        <footer>
          <img src="/assets/images/gwn.svg" alt=${competitionName(this.systemStatus?.competition)} />
          <img
            src="/assets/images/heiner-weiss.svg"
            alt=${competitionName(this.systemStatus?.competition)}
          />
          <img src="/assets/images/gwn.svg" alt=${competitionName(this.systemStatus?.competition)} />
          <img
            src="/assets/images/heiner-weiss.svg"
            alt=${competitionName(this.systemStatus?.competition)}
          />
        </footer>
      </div>
    `;
  }
}
