import { consume } from "@lit/context";
import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { User, userContext } from "../../contexts/user";
import "../elements/cup-context-club.js";
import "../elements/cup-club-act-manager.js";

@customElement("cup-view-acts")
export default class CupViewActs extends LitElement {
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

    header {
      display: grid;
      background: #002d56;
      padding: 2rem 0;
      color: #fff;
      grid-template-columns: 1fr 2fr;
      grid-template-rows: auto auto auto;
      grid-template-areas: "img h1" "img date" "img location";
      place-items: center start;
    }

    header img {
      grid-area: img;
      width: 100%;
      min-height: 0;
      height: 7rem;
      max-height: 100%;
    }

    header h1 {
      grid-area: h1;
      font-size: 2rem;
      text-align: center;
    }

    header .date {
      grid-area: date;
      text-align: right;
    }

    header .location {
      grid-area: location;
      text-align: right;
    }

    main {
      max-width: 1800px;
      margin: 0 auto;
      padding: 2rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    #back-link {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      align-self: flex-start;
      border-radius: 0.5rem;
      cursor: pointer;
      padding: 0.25rem 0.75rem;
      border: none;
      text-decoration: none;
      border-radius: 100vh;
      background: rgb(0, 45, 86);
      color: #fff;
    }
  `;

  @consume({ context: userContext, subscribe: true })
  user: User | null = null;
  @state() message = "Hello, World!";

  override render() {
    return html`<header>
        <img src="/assets/images/nrw-freestyle-cup.svg" />
        <h1>Anmeldung NRW Freestyle Cup</h1>
        <span class="date">19.04.2026</span>
        <span class="location">SSV Nümbrecht</span>
      </header>
      <main>
        <a id="back-link" href="/"
          ><i class="material-icon">arrow_back</i> Zurück</a
        >
        <h2>Kür Manager</h2>
        ${this.user?.club_id
          ? html`
              <cup-context-club club-id=${this.user?.club_id}
                ><cup-club-act-manager></cup-club-act-manager
              ></cup-context-club>
            `
          : nothing}
      </main>`;
  }
}
