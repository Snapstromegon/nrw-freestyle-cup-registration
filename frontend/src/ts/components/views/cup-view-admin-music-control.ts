import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";

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
  `;

  currentStarter = new Task(this, {
    task: async () => {},
    args: () => [],
  });

  override render() {
    return html`
      <div id="wrapper">
        <aside id="overview">
          <h2>Overview</h2>
        </aside>
        <aside id="next">
          <h2>Next</h2>
        </aside>
        <aside id="previous">
          <h2>Previous</h2>
        </aside>
        <main>
          ${this.currentStarter.render({
            loading: () => html`Loading...`,
            error: (error) => html`Error: ${error}`,
            complete: (currentStarter) => html`
              <h1>Aktueller Starter</h1>
            `,
          })}
        </main>
      </div>
    `;
  }
}
