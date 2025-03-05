import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { client } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";
import "../elements/cup-timeplan.js";

@customElement("cup-view-info-board")
export default class CupViewInfoBoard extends LitElement {
  static override styles = css`
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
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
      background: radial-gradient(circle at center, #002d56 .1vh, #002d5600 .1vh);
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
      grid-area: main;
      align-self: center;
      position: relative;
      display: flex;
      img#fallback {
        width: 66vh;
        margin: auto;
      }
    }
  `;
  predictedTimeplan = new Task(this, {
    task: async () => {
      const res = await client.GET("/api/query/predict_timeplan");
      return res.data;
    },
    args: () => [],
  });

  currentTimeplanEntry = new Task(this, {
    task: async ([predictedTimeplan]) =>
      predictedTimeplan?.items.find((item) => item.status === "Started"),
    args: () => [this.predictedTimeplan.value],
  });

  currentOrNextTimeplanEntry = new Task(this, {
    task: async ([predictedTimeplan]) =>
      predictedTimeplan?.items.find(
        (item) => item.status === "Started" || item.status === "Planned"
      ),
    args: () => [this.predictedTimeplan.value],
  });

  upcomingTimeplan = new Task(this, {
    task: async ([predictedTimeplan]) =>
      predictedTimeplan?.items.filter(
        (item) => item.status === "Planned" || item.status === "Started"
      ),
    args: () => [this.predictedTimeplan.value],
  });

  currentStarter = new Task(this, {
    task: async ([predictTimeplan]) => {
      const entry = predictTimeplan?.items.find(
        (item) => item.status === "Started"
      );
      if (!entry) {
        return undefined;
      }
      if ("Category" in entry.timeplan_entry) {
        const act = entry.timeplan_entry.Category.acts.find(
          (act) => act.status == "Started"
        );
        const completeAct = act
          ? (
              await client.GET("/api/query/get_act", {
                params: {
                  query: {
                    act_id: act?.id,
                  },
                },
              })
            ).data
          : null;
        return {
          entry: entry,
          act: act,
          completeAct,
        };
      }
      return { entry };
    },
    args: () => [this.predictedTimeplan.value],
  });

  dataUpdateInterval?: number;

  override connectedCallback() {
    super.connectedCallback();
    this.dataUpdateInterval = setInterval(() => {
      this.predictedTimeplan.run();
    }, 10000);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.dataUpdateInterval);
  }

  override render() {
    return html`
      <div id="wrapper">
        <aside>
          <h1>NRW Freestyle Cup 2025</h1>
          <img
            id="logo"
            src="/assets/images/nrw-freestyle-cup.svg"
            alt="NRW Freestyle Cup 2025"
          />
          <cup-timeplan
            .timeplan=${this.predictedTimeplan.value}
          ></cup-timeplan>
        </aside>
        <main>
          <img id="fallback" src="/assets/images/logo_with_blobs.svg" alt="NRW Freestyle Cup 2025" />
        </main>
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
