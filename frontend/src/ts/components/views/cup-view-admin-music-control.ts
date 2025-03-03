import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { client } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";
import { repeat } from "lit/directives/repeat.js";

@customElement("cup-view-admin-music-control")
export default class CupViewAdminMusicControl extends LitElement {
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
      grid-template-rows: 1fr 1fr 1fr;
      grid-template-areas: "overview main" "previous main" "next main";
      height: 100dvh;
    }

    main {
      grid-area: main;
    }

    #next {
      grid-area: next;
    }

    #previous {
      grid-area: previous;
    }

    #overview {
      grid-area: overview;
    }

    li {
      padding-left: 1rem;
      margin: 1rem;
    }
  `;

  predictedTimeplan = new Task(this, {
    task: async () => {
      const res = await client.GET("/api/query/predict_timeplan");
      return res.data;
    },
    args: () => [],
  });

  toDuration(seconds: number) {
    return `${seconds <= 0 ? "-" : ""}${Math.floor(Math.abs(seconds) / 60)
      .toString()
      .padStart(2, "0")}:${(Math.abs(seconds) % 60)
      .toString()
      .padStart(2, "0")}`;
  }

  override render() {
    return html`
      ${this.predictedTimeplan.render({
        loading: () => html`Loading...`,
        error: (error) => html`Error: ${error}`,
        complete: (predictedTimeplan) => html`
          <div id="wrapper">
            <aside id="overview">
              <h2>Overview</h2>
              <h3>Verzug</h3>
              ${this.toDuration(predictedTimeplan?.offset || 0)}
            </aside>
            <aside id="next">
              <h2>Next</h2>
              <ul>
                ${repeat(
                  predictedTimeplan?.items || [],
                  (item) =>
                    "Category" in item.timeplan_entry
                      ? item.timeplan_entry.Category.name
                      : item.timeplan_entry.Custom.label,
                  (item) => html`
                    <li>
                      ${"Category" in item.timeplan_entry
                        ? html` ${new Date(
                              item.predicted_start
                            ).toLocaleTimeString()}
                            -
                            ${new Date(
                              item.predicted_end
                            ).toLocaleTimeString()}<br />${item.timeplan_entry
                              .Category.name}
                            <ol>
                              <li>
                                ${new Date(
                                  item.predicted_start
                                ).toLocaleTimeString()}
                                -
                                ${new Date(
                                  new Date(item.predicted_start).getTime() +
                                    item.timeplan_entry.Category
                                      .einfahrzeit_seconds *
                                      1000
                                ).toLocaleTimeString()}<br />
                                Einfahrzeit
                              </li>
                              ${repeat(
                                item.timeplan_entry.Category.acts || [],
                                (acts) => acts.id,
                                (acts) =>
                                  html`<li>
                                    ${new Date(
                                      acts.predicted_start
                                    ).toLocaleTimeString()}
                                    -
                                    ${new Date(
                                      acts.predicted_end
                                    ).toLocaleTimeString()}<br />
                                    ${acts.name}
                                  </li> `
                              )}
                            </ol>`
                        : html` ${new Date(
                              item.predicted_start
                            ).toLocaleTimeString()}
                            -
                            ${new Date(
                              item.predicted_end
                            ).toLocaleTimeString()}<br />${item.timeplan_entry
                              .Custom.label}`}
                    </li>
                  `
                )}
              </ul>
            </aside>
            <aside id="previous">
              <h2>Previous</h2>
            </aside>
            <main>
              <h1>Aktueller Starter</h1>
              <button class="material-icon" @click=${this.timeplanBackward}>
                arrow_back
              </button>
              <button class="material-icon" @click=${this.timeplanForward}>
                arrow_forward
              </button>
            </main>
          </div>
        `,
      })}
    `;
  }

  async timeplanBackward() {
    await client.POST("/api/command/timeplan_backward");
    this.predictedTimeplan.run();
  }

  async timeplanForward() {
    await client.POST("/api/command/timeplan_forward");
    this.predictedTimeplan.run();
  }
}
