import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { errorMessage } from "../../api";
import { client } from "../../apiClient";
import { type User, userContext } from "../../contexts/user";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import {
  type SystemStatus,
  systemStatusContext,
} from "../../contexts/systemStatus";
import { competitionName, formatDateRange } from "../../utils";

@customElement("cup-view-home")
export default class CupViewHome extends LitElement {
  @consume({ context: systemStatusContext, subscribe: true })
  systemStatus: SystemStatus | null = null;

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

    #logout {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      align-self: flex-start;
      border-radius: 0.5rem;
      cursor: pointer;
      padding: 0.25rem 0.75rem;
      border: none;
      border-radius: 100vh;
      background: #e2001a;
      color: #fff;
    }

    @media print {
      #logout {
        display: none;
      }
    }
  `;

  @consume({ context: userContext, subscribe: true })
  user: User | null = null;
  @state() message = "Hello, World!";

  override render() {
    return html`<header>
        <img src="/assets/images/nrw-freestyle-cup.svg" />
        <h1>Anmeldung ${competitionName(this.systemStatus?.competition)}</h1>
        <span class="date"
          >${
            this.systemStatus?.competition
              ? formatDateRange(
                  this.systemStatus.competition.start_date,
                  this.systemStatus.competition.end_date,
                )
              : nothing
          }</span
        >
        <span class="location"
          >${this.systemStatus?.competition?.location}</span
        >
      </header>
      <main>
        <h2>Hi ${this.user?.name}</h2>
        ${
          this.user?.is_admin
            ? html`<p>Du bist Admin! <a href="/admin">Admininterface</a></p>`
            : nothing
        }
        <p>
          Deine Email ist ${this.user?.email}. Verifiziert:
          ${this.user?.email_verified ? "✔️" : "❌"}
        </p>
        <button @click=${this.logout} id="logout">
          <i class="material-icon">logout</i> Logout
        </button>

        <h2>Verein</h2>

        ${
          this.user?.email_verified
            ? this.user?.club_id
              ? html`<cup-context-club club-id=${this.user?.club_id}
                ><cup-club-manager></cup-club-manager
              ></cup-context-club>`
              : html`<a href="/create_club">Verein Erstellen</a>`
            : html`<p>
              Du musst deine EMail verifizieren, um einen Verein zu erstellen.
              Falls du keine Verifizierungsmail bekommen hast, kannst du hier
              eine neue versenden:
              <button @click=${this.reverifyMail}>
                Neue Verifizierungsmail schicken
              </button>
            </p>`
        }
      </main>`;
  }

  async logout() {
    await client.POST("/api/command/logout");
    window.location.href = "/";
    this.dispatchEvent(new Event("logout", { bubbles: true, composed: true }));
  }

  async reverifyMail() {
    const data = await client.POST("/api/command/resend_mail_validation", {
      body: {},
    });
    if (data.error !== undefined || !data.response.ok) {
      console.error(data.error);
      alert(
        `Fehler beim Versenden der Mail: ${errorMessage(data.error, data.response.status)}`,
      );
      return;
    }
    alert("Mail wurde versendet.");
  }
}
