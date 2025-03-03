import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { client } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";
import { repeat } from "lit/directives/repeat.js";
import "../elements/cup-timeplan.js";

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
      grid-template-rows: 1fr 1fr 50dvh;
      grid-template-areas: "overview main" "previous main" "next main";
      height: 100dvh;
    }

    main {
      grid-area: main;
    }

    #next {
      grid-area: next;
      height: 100%;
    }

    cup-timeplan {
      height: 100%;
      overflow: auto;
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

    .current {
      background: #48f;
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

  toDuration(seconds: number) {
    return `${seconds <= 0 ? "-" : ""}${Math.floor(Math.abs(seconds) / 60)
      .toString()
      .padStart(2, "0")}:${(Math.abs(seconds) % 60)
      .toString()
      .padStart(2, "0")}`;
  }

  override render() {
    return html`<div id="wrapper">
      ${this.predictedTimeplan.render({
        loading: () => html`Loading...`,
        error: (error) => html`Error: ${error}`,
        complete: (predictedTimeplan) => html`
          <aside id="overview">
            <h2>Overview</h2>
            <h3>Verzug</h3>
            ${this.toDuration(predictedTimeplan?.offset || 0)}
          </aside>
        `,
      })}
            <aside id="next">
              <cup-timeplan .timeplan=${
                this.predictedTimeplan.value
              }></cup-timeplan>
              </aside>
            <main>
              <h1>Aktueller Stand</h1>
              ${this.currentTimeplanEntry.render({
                loading: () => html`Loading...`,
                error: (error) => html`Error: ${error}`,
                complete: (currentTimeplanEntry) => html`
                  <h2>
                    ${currentTimeplanEntry
                      ? "Category" in currentTimeplanEntry.timeplan_entry
                        ? currentTimeplanEntry.timeplan_entry.Category.name
                        : currentTimeplanEntry.timeplan_entry.Custom.label
                      : "Inaktiv"}
                  </h2>
                `,
              })}
              ${this.currentStarter.render({
                loading: () => html`Loading...`,
                error: (error) => html`Error: ${error}`,
                complete: (currentStarter) => html`
                  ${currentStarter
                    ? "Category" in currentStarter?.entry.timeplan_entry
                      ? currentStarter.act
                        ? html`
                            <h3>
                              ${currentStarter.completeAct?.participants
                                .map((p) => `${p.firstname} ${p.lastname}`)
                                .join(" & ")}
                            </h3>
                            <h4>${currentStarter.completeAct?.name}</h4>
                            <p>${currentStarter.completeAct?.description}</p>
                            <audio
                              controls
                              src="/songs/${currentStarter.completeAct
                                ?.song_file || ""}"
                              preload="auto"
                            ></audio>
                          `
                        : html` <h3>Einfahrzeit</h3>`
                      : html`
                          <h3>
                            ${currentStarter?.entry.timeplan_entry.Custom
                              ?.label}
                          </h3>
                        `
                    : "No current starter"}
                `,
              })}
              <button class="material-icon" @click=${this.timeplanBackward}>
                arrow_back
              </button>
              <button class="material-icon" @click=${this.timeplanForward}>
                arrow_forward
              </button>
            </main>
          </div>
        
    </div> `;
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
