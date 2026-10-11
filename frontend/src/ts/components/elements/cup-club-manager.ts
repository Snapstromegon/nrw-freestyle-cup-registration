import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { type Club, clubContext } from "../../contexts/club";
import "./cup-club-starter-manager.js";
import "./cup-club-group-manager.js";
import "./cup-club-act-manager.js";
import { Task } from "@lit/task";
import { unwrap } from "../../api";
import { client, type components } from "../../apiClient";
import {
  type SystemStatus,
  systemStatusContext,
} from "../../contexts/systemStatus";
import { resetStyles } from "../../styles/base";
import { formatDate, formatMoney, getStarterPrice } from "../../utils";

/**
 * Everything a club manages: acts, starters and groups. The managers depend
 * on each other (groups change fees and acts, deleting a starter changes
 * groups), so after a change in one of them all are reloaded: each manager
 * dispatches a cancelable `club-data-changed` event, this element cancels it
 * (meaning "handled") and bumps the managers' `refresh`.
 */
type ClubStarter = components["schemas"]["ClubStarter"];

@customElement("cup-club-manager")
export default class CupClubManager extends LitElement {
  static override styles = [
    resetStyles,
    css`
      /* Admin pages embed it in dense (nowrap) table cells. */
      :host {
        display: block;
        white-space: normal;
      }

      h3 {
        margin-bottom: 0.5em;
        position: sticky;
        top: var(--admin-sticky-top, 0px);
        z-index: 3;
        background: var(--cup-surface);
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
        border: 0.2rem solid var(--cup-red);
        border-radius: 0.5rem;
        padding: 0.5rem;
        text-align: left;
        max-width: 100%;

        td {
          padding: 0.2rem 0.5rem;
          /* Long values (IBAN) wrap instead of widening the page on phones. */
          overflow-wrap: anywhere;
        }
      }
    `,
  ];

  @consume({ context: clubContext, subscribe: true }) club: Club | null = null;

  @consume({ context: systemStatusContext, subscribe: true })
  systemStatus: SystemStatus | null = null;

  @property({ type: Boolean, attribute: "admin-mode" }) adminMode = false;

  /** Passed to the managers; bumping it makes them reload. */
  @state() refresh = 0;

  starters = new Task(this, {
    task: async ([clubId]): Promise<ClubStarter[]> => {
      if (!clubId) {
        return [];
      }
      return unwrap(
        await client.GET("/api/query/list_club_starters", {
          params: { query: { club_id: clubId } },
        }),
      );
    },
    args: () => [this.club?.id, this.refresh],
  });

  constructor() {
    super();
    this.addEventListener("club-data-changed", this.onClubDataChanged);
  }

  onClubDataChanged = (e: Event) => {
    e.preventDefault();
    this.refresh++;
  };

  override render() {
    const competition = this.systemStatus?.competition;
    const payment = (label: string, value: string | null | undefined) =>
      value ? html`<tr><th>${label}</th><td>${value}</td></tr>` : nothing;
    const amount = (this.starters.value || []).reduce(
      (acc, starter) => acc + getStarterPrice(starter, competition),
      0,
    );
    const paid = this.club?.payment ?? 0;
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
                <td>${formatMoney(amount)}</td>
              </tr>
              <tr>
                <th>Bezahlt</th>
                <td>${formatMoney(paid)}</td>
              </tr>
              ${
                amount > paid
                  ? html`<tr>
                    <th>Offen</th>
                    <td>${formatMoney(amount - paid)}</td>
                  </tr>`
                  : nothing
              }
            </table>
            <p>
              <i
                ><strong>Hinweis:</strong> Zahlungen werden von uns manuell
                bestätigt, daher kann die „Bezahlt“-Angabe teils mehrere Tage
                Verzug haben.</i
              >
            </p>
          `
      }

      <cup-club-act-manager
        ?admin-mode=${this.adminMode}
        .refresh=${this.refresh}
      ></cup-club-act-manager>
      <hr />
      <cup-club-starter-manager
        ?admin-mode=${this.adminMode}
        .refresh=${this.refresh}
      ></cup-club-starter-manager>
      <hr />
      <cup-club-group-manager
        ?admin-mode=${this.adminMode}
        .refresh=${this.refresh}
      ></cup-club-group-manager>`;
  }
}
