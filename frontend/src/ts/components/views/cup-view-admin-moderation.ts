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

@customElement("cup-view-admin-moderation")
export default class CupViewAdminModeration extends LitElement {
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

  override render() {
    return html`
      <div id="wrapper">
        <aside>
          <cup-timeplan
            .timeplan=${this.predictedTimeplan}
            description
            include-active-act
          ></cup-timeplan>
        </aside>
      </div>
    `;
  }
}
