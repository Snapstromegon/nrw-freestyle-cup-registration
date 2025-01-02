import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { Club, clubContext } from "../../contexts/club";
import "./cup-club-starter-manager.js";
import "./cup-club-judge-manager.js";

@customElement("cup-club-manager")
export default class CupClubManager extends LitElement {
  static override styles = css`
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    h3 {
      margin-bottom: 0.5em;
    }
    h4,
    p {
      margin-top: 1em;
      margin-bottom: 0.5em;
    }
  `;

  @consume({ context: clubContext, subscribe: true }) club: Club | null = null;

  @property({ type: Boolean }) adminMode = false;

  override render() {
    return html`<h3>${this.club?.name}</h3>
      ${this.adminMode
        ? nothing
        : html`
            <p>
              Der anmeldende Trainer ist dafür verantwortlich, dass alle Starter
              den Bedingungen aus der Ausschreibung wie zum Beispiel der
              Veröffentlichung von Namen und Bildern zustimmen.
            </p>

            <p>
              Änderungen können noch bis zum Anmeldeschluss am
              <strong>02.02.2025</strong> vorgenommen werden.
            </p>
          `}

      <cup-club-starter-manager
        ?adminMode=${this.adminMode}
      ></cup-club-starter-manager>
      <cup-club-judge-manager
        ?adminMode=${this.adminMode}
      ></cup-club-judge-manager> `;
  }
}
