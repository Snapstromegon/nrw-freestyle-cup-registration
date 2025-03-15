import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";
import "../elements/cup-timeplan.js";
import {
  currentTimeplanAct,
  currentTimeplanEntry,
  lastTimeplanAct,
  lastTimeplanEntry,
  TimeplanStatus,
  timeplanStatus,
} from "../../utils.js";
import "../elements/cup-clock.js";
import "../elements/cup-countdown.js";
import "../elements/cup-fotobox.js";

@customElement("cup-view-info-board")
export default class CupViewInfoBoard extends LitElement {
  static override styles = css`
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: "Mona Sans";
    }
    .material-icon {
      font-family: "Material Symbols Outlined";
      font-weight: normal;
      font-style: normal;
      font-size: 24px;
      line-height: 1;
      letter-spacing: normal;
      text-transform: none;
      display: inline-block;
      white-space: nowrap;
      word-wrap: normal;
      direction: ltr;
      font-feature-settings: "liga";
      -webkit-font-smoothing: antialiased;
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
      display: flex;
      flex-direction: column;
      gap: 3dvh;
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
      }

      cup-timeplan {
        overflow: hidden;
        flex-shrink: 1;
        width: 100%;
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

        mask: radial-gradient(
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
    }

    #logo {
      height: 20dvh;
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

  lastRawTimeplan?: components["schemas"]["Timeplan"];

  @state() predictedTimeplan?: components["schemas"]["Timeplan"];

  allActs = new Task(this, {
    task: async () => (await client.GET("/api/query/list_acts")).data,
    args: () => [],
  });

  dataUpdateInterval?: number;

  override connectedCallback() {
    super.connectedCallback?.();
    this.dataUpdateInterval = setInterval(async () => {
      const newTimeplan = (await client.GET("/api/query/predict_timeplan"))
        .data;
      if (
        JSON.stringify(newTimeplan) !== JSON.stringify(this.lastRawTimeplan)
      ) {
        this.predictedTimeplan = newTimeplan;
        this.lastRawTimeplan = this.predictedTimeplan;
      }
    }, 1000);
  }

  override disconnectedCallback() {
    super.disconnectedCallback?.();
    clearInterval(this.dataUpdateInterval);
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
    let timeplan = this.predictedTimeplan;
    const status = timeplanStatus(timeplan);
    const currentEntry = currentTimeplanEntry(timeplan);
    const currentAct = currentTimeplanAct(timeplan);
    const lastEntry = lastTimeplanEntry(timeplan);
    switch (status) {
      case TimeplanStatus.Break:
        return html`<div class="break">
          <cup-fotobox
            src="${lastEntry
              ? "http://nrw-cup-fotos:8080/random"
              : "/assets/images/logo_with_blobs.svg"}"
            auto-reload
          ></cup-fotobox>
          <cup-clock></cup-clock>
        </div>`;
      case TimeplanStatus.Warmup:
        return html`<div class="warmup">
          <h1>Einfahrzeit</h1>
          <h2>
            ${currentEntry && "Category" in currentEntry.timeplan_entry
              ? currentEntry.timeplan_entry.Category.description
              : "Invalid State"}
          </h2>
          <cup-countdown
            .time=${new Date(
              new Date(currentEntry?.predicted_start || "").getTime() +
                (currentEntry && "Category" in currentEntry.timeplan_entry
                  ? currentEntry.timeplan_entry.Category.einfahrzeit_seconds *
                    1000
                  : 0)
            )}
          ></cup-countdown>
        </div>`;
      case TimeplanStatus.Act:
        return html`<div class="act">
          <h1>${currentAct?.name}</h1>
          <div class="starters">
            ${this.allActs.value
              ?.find((a) => a.id == currentAct?.id)
              ?.participants.map(
                (p) => html`
                  <div class="starter">
                    <h2>${p.firstname} ${p.lastname}</h2>
                    <h3>${p.club_name}</h3>
                  </div>
                `
              )}
          </div>
          <h3>
            ${currentEntry && "Category" in currentEntry.timeplan_entry
              ? currentEntry.timeplan_entry.Category.description
              : "Invalid State"}
          </h3>
        </div>`;
      case TimeplanStatus.Judging:
        return html`<div class="judging">
          <cup-fotobox src="http://nrw-cup-fotos:8080/newest?date=${Math.floor(new Date().getTime()/1000/60)}"></cup-fotobox>
          <section>
            <h3>Das war...</h3>
            <h1>${lastTimeplanAct(timeplan)?.name}</h1>
            <div class="starters">
              ${this.allActs.value
                ?.find((a) => a.id == lastTimeplanAct(timeplan)?.id)
                ?.participants.map(
                  (p) => html`
                    <div class="starter">
                      <h2>${p.firstname} ${p.lastname}</h2>
                      <h3>${p.club_name}</h3>
                    </div>
                  `
                )}
            </div>
            <h3>
              ${currentEntry && "Category" in currentEntry.timeplan_entry
                ? currentEntry.timeplan_entry.Category.description
                : "Invalid State"}
            </h3>
            <cup-clock></cup-clock>
          </section>
        </div>`;
      case TimeplanStatus.Award:
        return html`<div class="award">
          <img
            id="fallback"
            src="/assets/images/logo_with_blobs.svg"
            alt="NRW Freestyle Cup 2025"
          />
          <h1>Siegerehrung</h1>
        </div>`;
    }
    return nothing;
  }

  override render() {
    console.log("Info Board Rendering", this.predictedTimeplan);
    return html`
      <div id="wrapper">
        <aside>
          <h1>NRW Freestyle Cup 2025</h1>
          <img
            id="logo"
            src="/assets/images/nrw-freestyle-cup.svg"
            alt="NRW Freestyle Cup 2025"
          />
          <cup-timeplan .timeplan=${this.predictedTimeplan}></cup-timeplan>
        </aside>
        <main>${this.renderMain()}</main>
        <footer>
          <img src="/assets/images/gwn.svg" alt="NRW Freestyle Cup 2025" />
          <img
            src="/assets/images/heiner-weiss.svg"
            alt="NRW Freestyle Cup 2025"
          />
          <img src="/assets/images/gwn.svg" alt="NRW Freestyle Cup 2025" />
          <img
            src="/assets/images/heiner-weiss.svg"
            alt="NRW Freestyle Cup 2025"
          />
        </footer>
      </div>
    `;
  }
}
