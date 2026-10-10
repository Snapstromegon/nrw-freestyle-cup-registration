import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { type Club, clubContext } from "../../contexts/club";
import "./cup-club-starter-manager.js";
import "./cup-club-act-manager.js";
import { Task } from "@lit/task";
import { client } from "../../apiClient";
import {
  type SystemStatus,
  systemStatusContext,
} from "../../contexts/systemStatus";
import { formatDate, getStarterPrice } from "../../utils";

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

  @consume({ context: systemStatusContext, subscribe: true })
  systemStatus: SystemStatus | null = null;

  @property({ type: Boolean, attribute: "admin-mode" }) adminMode = false;

  starters = new Task(this, {
    task: async ([clubId]) => {
      if (!clubId) {
        return [];
      }
      const resp = await client.GET("/api/query/list_club_starters", {
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
    const competition = this.systemStatus?.competition;
    const payment = (label: string, value: string | null | undefined) =>
      value ? html`<tr><th>${label}</th><td>${value}</td></tr>` : nothing;
    return html`<h3>${this.club?.name}</h3>
      ${
        this.adminMode
          ? nothing
          : html`
            <p>
              Der anmeldende Trainer ist dafür verantwortlich, dass alle Starter
              den Bedingungen aus der Ausschreibung wie zum Beispiel der
              Veröffentlichung von Namen und Bildern zustimmen.
            </p>

            ${
              competition
                ? html`<p>
                  Änderungen können noch bis zum Anmeldeschluss am
                  <strong>${formatDate(competition.registration_end)}</strong>
                  vorgenommen werden.
                </p>`
                : nothing
            }

            <h4>Zahlungsinformationen</h4>
            <table class="zahlungsinformationen">
              ${payment(
                "Zahlungsfrist",
                competition?.payment_deadline &&
                  formatDate(competition.payment_deadline),
              )}
              ${payment("Kontoinhaber", competition?.payment_account_holder)}
              ${payment("IBAN", competition?.payment_iban)}
              ${payment("BIC", competition?.payment_bic)}
              ${payment(
                "Verwendungszweck",
                competition?.payment_reference
                  ? `${competition.payment_reference}: ${this.club?.name}`
                  : this.club?.name,
              )}
              <tr>
                <th>Betrag</th>
                <td>
                  ${(this.starters.value || []).reduce(
                    (acc, starter) =>
                      acc + getStarterPrice(starter, competition),
                    0,
                  )}€
                </td>
              </tr>
              <tr>
                <th>Bezahlt</th>
                <td>
                  ${
                    this.club?.payment
                      ?.toFixed(2)
                      .toString()
                      .replace(".", ",") || "0"
                  }€
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
          `
      }

      <cup-club-act-manager></cup-club-act-manager>
      <hr />
      <cup-club-starter-manager
        ?admin-mode=${this.adminMode}
      ></cup-club-starter-manager> `;
  }
}
