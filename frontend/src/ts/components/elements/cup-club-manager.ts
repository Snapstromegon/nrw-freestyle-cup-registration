import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { Club, clubContext } from "../../contexts/club";
import "./cup-club-starter-manager.js";
import "./cup-club-judge-manager.js";
import "./cup-club-act-manager.js";
import { Task } from "@lit/task";
import { client } from "../../apiClient";
import { getStarterPrice } from "./cup-club-starter-manager.js";

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
      position: sticky;
      top: 0;
      background: white;
      padding: 0.5rem 0;
      border-bottom: 0.1rem solid #000;
    }
    h4,
    p,
    hr {
      margin-top: 1em;
      margin-bottom: 0.5em;
    }

    .zahlungsinformationen {
      border: 0.2rem solid rgb(226, 0, 26);
      border-radius: 0.5rem;
      padding: 0.5rem;
      text-align: left;

      td {
        padding: 0.2rem 0.5rem;
      }
    }
  `;

  @consume({ context: clubContext, subscribe: true }) club: Club | null = null;

  @property({ type: Boolean }) adminMode = false;

  starters = new Task(this, {
    task: async ([clubId]) => {
      if (!clubId) {
        return [];
      }
      let resp = await client.GET("/api/query/list_club_starters", {
        params: { query: { club_id: clubId } },
      });
      if (resp.error) {
        throw new Error((resp.error as any).message);
      }
      return resp.data.map((starter) => {
        const birthdate = new Date(starter.birthdate);
        return { ...starter, birthdate };
      });
    },
    args: () => [this.club?.id],
  });

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
              <strong>15.03.2026</strong> vorgenommen werden.
            </p>

            <h4>Zahlungsinformationen</h4>
            <table class="zahlungsinformationen">
              <tr>
                <th>Zahlungsfrist</th>
                <td>05.04.2026</td>
              </tr>
              <tr>
                <th>Kontoinhaber</th>
                <td>Peter Kaufmann</td>
              </tr>
              <tr>
                <th>IBAN</th>
                <td>DE65 1203 0000 1060 4054 85</td>
              </tr>
              <tr>
                <th>BIC</th>
                <td>BYLADEM1001</td>
              </tr>
              <tr>
                <th>Verwendungszweck</th>
                <td>Startgeld: ${this.club?.name}</td>
              </tr>
              <tr>
                <th>Betrag</th>
                <td>
                  ${(this.starters.value || []).reduce(
                    (acc, starter) => acc + getStarterPrice(starter),
                    0
                  )}€
                </td>
              </tr>
              <tr>
                <th>Bezahlt</th>
                <td>
                  ${this.club?.payment
                    ?.toFixed(2)
                    .toString()
                    .replace(".", ",") || "0"}€
                </td>
              </tr>
            </table>
            <p>
              <i
                ><strong>Hinweis:</strong> Zahlungen werden von uns manuell
                bestätigt, daher kann die "Gezahlt" Angabe teils mehrere Tage
                Verzug haben.</i
              >
            </p>
          `}

      <cup-club-act-manager></cup-club-act-manager>
      <hr />
      <cup-club-starter-manager
        ?admin-mode=${this.adminMode}
      ></cup-club-starter-manager>
      <hr />
      <cup-club-judge-manager
        ?adminMode=${this.adminMode}
      ></cup-club-judge-manager> `;
  }
}
