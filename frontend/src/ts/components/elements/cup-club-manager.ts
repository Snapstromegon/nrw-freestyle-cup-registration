import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { type Club, clubContext } from "../../contexts/club";
import "./cup-club-starter-manager.js";
import "./cup-club-group-manager.js";
import "./cup-club-act-manager.js";
import { Task, TaskStatus } from "@lit/task";
import { unwrap } from "../../api";
import { client, type schemas } from "../../apiClient";
import {
  type SystemStatus,
  systemStatusContext,
} from "../../contexts/systemStatus";
import { resetStyles } from "../../styles/base";
import { buildEpcPayload, paymentReference } from "../../epc";
import { formatDate, formatMoney, getStarterPrice } from "../../utils";
import "./cup-payment-qr.js";

type Competition = schemas.Competition;

/**
 * Everything a club manages: acts, starters and groups. The managers depend
 * on each other (groups change fees and acts, deleting a starter changes
 * groups), so after a change in one of them all are reloaded: each manager
 * dispatches a cancelable `club-data-changed` event, this element cancels it
 * (meaning "handled") and bumps the managers' `refresh`.
 */
type ClubStarter = schemas.ClubStarter;

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

      .payment {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        align-items: flex-start;
      }

      .qr {
        margin: 0;
        max-width: 200px;
        break-inside: avoid;

        figcaption {
          font-size: 0.85em;
        }
      }

      .event-info {
        padding-left: 1.25em;
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
      return await unwrap(
        client.listClubStarters({
          query: { club_id: clubId },
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

  /**
   * The bank details, the amounts and, while something is open, an EPC QR
   * code ("GiroCode") for the open amount.
   */
  renderPayment(amount: number, paid: number) {
    const competition = this.systemStatus?.competition;
    const club = this.club;
    const payment = (label: string, value: string | null | undefined) =>
      value ? html`<tr><th>${label}</th><td>${value}</td></tr>` : nothing;
    const open = Math.round((amount - paid) * 100) / 100;
    const reference = club
      ? paymentReference(competition?.payment_reference, club.name, club.code)
      : "";
    // Only once the starters are loaded, so the amount is right.
    const payload =
      club &&
      competition?.payment_account_holder &&
      competition.payment_iban &&
      this.starters.status === TaskStatus.COMPLETE &&
      open >= 0.01
        ? buildEpcPayload({
            name: competition.payment_account_holder,
            iban: competition.payment_iban,
            bic: competition.payment_bic,
            amount: open,
            text: paymentReference(
              competition.payment_reference,
              club.name,
              club.code,
              { qr: true },
            ),
          })
        : null;
    const contact = competition?.contact_email;
    return html`<h4>Zahlungsinformationen</h4>
      <div class="payment">
        <table class="zahlungsinformationen">
          ${payment(
            "Zahlungsfrist",
            competition?.payment_deadline
              ? formatDate(competition.payment_deadline)
              : "wird noch bekannt gegeben",
          )}
          ${payment("Kontoinhaber", competition?.payment_account_holder)}
          ${payment("IBAN", competition?.payment_iban)}
          ${payment("BIC", competition?.payment_bic)}
          ${payment("Verwendungszweck", reference)}
          <tr>
            <th>Betrag</th>
            <td>${formatMoney(amount)}</td>
          </tr>
          <tr>
            <th>Bezahlt</th>
            <td>${formatMoney(paid)}</td>
          </tr>
          ${
            open >= 0.01
              ? html`<tr>
                  <th>Offen</th>
                  <td><strong>${formatMoney(open)}</strong></td>
                </tr>`
              : open <= -0.01
                ? html`<tr>
                    <th>Überzahlt</th>
                    <td>
                      ${formatMoney(-open)}${
                        contact
                          ? html` – Meldet euch bitte bei
                              <a href="mailto:${contact}">${contact}</a>.`
                          : nothing
                      }
                    </td>
                  </tr>`
                : amount > 0
                  ? html`<tr>
                      <th>Offen</th>
                      <td>Alles bezahlt – danke!</td>
                    </tr>`
                  : nothing
          }
        </table>
        ${
          payload
            ? html`<figure class="qr">
                <cup-payment-qr .payload=${payload}></cup-payment-qr>
                <figcaption>
                  QR-Code für die Überweisung des offenen Betrags (mit der
                  Banking-App scannen)
                </figcaption>
              </figure>`
            : nothing
        }
      </div>
      <p>
        <i
          ><strong>Hinweis:</strong> Zahlungen werden von uns manuell bestätigt,
          daher kann die „Bezahlt“-Angabe teils mehrere Tage Verzug haben. Schon
          überwiesen? Dann bitte nicht doppelt überweisen.</i
        >
      </p>`;
  }

  /** Deadlines and rules from the announcement, plus venue and contact. */
  renderEventInfo(competition: Competition) {
    return html`<ul class="event-info">
      <li>
        Anmeldungen und Änderungen sind bis zum Meldeschluss am
        <strong>${formatDate(competition.registration_end)}</strong> möglich.
        Nachmeldungen sind danach nicht möglich.
      </li>
      <li>
        Abmeldungen nach dem Meldeschluss: Die Startgebühr wird nur bei
        Krankheit mit ärztlichem Attest erstattet.
      </li>
      <li>
        Musik als mp3 bis zum
        <strong>${formatDate(competition.music_upload_end)}</strong> hochladen
        und zusätzlich auf einem USB-Stick mitbringen.
      </li>
      ${
        competition.venue
          ? html`<li>Veranstaltungsort: ${competition.venue}</li>`
          : nothing
      }
      ${
        competition.contact_email
          ? html`<li>
              Fragen:
              <a href="mailto:${competition.contact_email}"
                >${competition.contact_email}</a
              >
            </li>`
          : nothing
      }
    </ul>`;
  }

  override render() {
    const competition = this.systemStatus?.competition;
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
              den Bedingungen aus der
              ${
                competition?.announcement_url
                  ? html`<a
                      href=${competition.announcement_url}
                      target="_blank"
                      rel="noopener"
                      >Ausschreibung</a
                    >`
                  : "Ausschreibung"
              }
              wie zum Beispiel der Veröffentlichung von Namen und Bildern
              zustimmen.
            </p>

            ${competition ? this.renderEventInfo(competition) : nothing}

            ${this.renderPayment(amount, paid)}
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
