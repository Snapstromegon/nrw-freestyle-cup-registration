import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { client, type components } from "../../apiClient";
import "../elements/cup-timeplan.js";

@customElement("cup-view-admin-moderation")
export default class CupViewAdminModeration extends LitElement {
  static override styles = css`
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: "Mona Sans";
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
            include-original-time
          ></cup-timeplan>
        </aside>
      </div>
    `;
  }
}
