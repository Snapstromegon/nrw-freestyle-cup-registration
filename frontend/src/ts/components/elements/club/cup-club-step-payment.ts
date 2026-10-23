import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  type ClubData,
  hasStart,
  paymentState,
  starterName,
} from "../../../club-data";
import { buildEpcPayload, paymentReference } from "../../../epc";
import { iconStyles, resetStyles } from "../../../styles/base";
import { clubPortalStyles } from "../../../styles/club-portal";
import {
  type Competition,
  countStarts,
  formatDate,
  formatMoney,
  getStarterPrice,
} from "../../../utils";
import "../cup-payment-qr.js";
import { loadPref, savePref } from "./prefs";

/** Step 5: what to pay, how, and what was paid. */
@customElement("cup-club-step-payment")
export default class CupClubStepPayment extends LitElement {
  static override styles = [
    resetStyles,
    iconStyles,
    clubPortalStyles,
    css`
      .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .tile {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 1rem;
        border-radius: 0.75rem;
        border: 1px solid var(--cup-border);
        background: var(--cup-surface);
      }

      .tile span {
        color: var(--cup-muted);
        font-size: 0.875rem;
      }

      .tile strong {
        font-size: 1.5rem;
        color: var(--cup-blue);
      }

      .tile.open {
        background: var(--cup-blue);
        border-color: var(--cup-blue);
      }

      .tile.open span {
        color: var(--cup-blue-2);
      }

      .tile.open strong {
        color: #fff;
      }

      .tile.done {
        background: var(--cup-green);
        border-color: var(--cup-green);
      }

      .tile.done span,
      .tile.done strong {
        color: #fff;
      }

      .transfer {
        display: flex;
        flex-wrap: wrap;
        gap: 1.5rem;
        align-items: flex-start;
      }

      dl.bank {
        flex: 1 1 20rem;
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr) auto;
        gap: 0.375rem 0.75rem;
        align-items: center;
      }

      dl.bank dt {
        color: var(--cup-muted);
      }

      dl.bank dd {
        font-weight: 600;
        overflow-wrap: anywhere;
      }

      figure {
        width: 200px;
        max-width: 100%;
        text-align: center;
      }

      figcaption {
        font-size: 0.8rem;
        color: var(--cup-muted);
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        padding: 0.375rem 0.5rem;
        border-bottom: 1px solid var(--cup-border);
        text-align: left;
      }

      th {
        font-size: 0.8rem;
        color: var(--cup-muted);
      }

      .num {
        text-align: right;
        white-space: nowrap;
      }

      tfoot td {
        font-weight: 700;
        border-bottom: none;
      }

      details > summary {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
        list-style: none;
      }

      details > summary::-webkit-details-marker {
        display: none;
      }

      details > summary h3 {
        margin-right: auto;
      }

      details > summary .chevron {
        transition: rotate 0.15s;
      }

      details[open] > summary .chevron {
        rotate: 180deg;
      }

      details[open] > summary {
        margin-bottom: 0.75rem;
      }
    `,
  ];

  @property({ attribute: false }) data!: ClubData;
  @property({ attribute: false }) competition: Competition | null = null;

  @state() copied: string | null = null;
  @state() detailsOpen = loadPref("payment.detailsOpen", false);

  override render() {
    const competition = this.competition;
    const { startFees, juryFee, amount, paid, open } = paymentState(this.data);
    const contact = competition?.contact_email;
    return html`<div class="step-intro">
        <h2>4. Startgeld</h2>
        <p>
          Das Startgeld ergibt sich aus den Starts eurer Fahrer. Überweist den
          offenen Betrag am einfachsten per QR-Code mit eurer Banking-App.
        </p>
      </div>

      <div class="tiles">
        <div class="tile">
          <span>Startgeld</span><strong>${formatMoney(startFees)}</strong>
        </div>
        ${
          juryFee > 0
            ? html`<div class="tile">
                <span>Jurygebühr</span><strong>${formatMoney(juryFee)}</strong>
              </div>`
            : nothing
        }
        <div class="tile">
          <span>Gesamt</span><strong>${formatMoney(amount)}</strong>
        </div>
        <div class="tile">
          <span>Bezahlt</span><strong>${formatMoney(paid)}</strong>
        </div>
        <div class="tile ${open >= 0.01 ? "open" : amount > 0 ? "done" : ""}">
          <span
            >${
              open >= 0.01
                ? "Offen"
                : open <= -0.01
                  ? "Überzahlt"
                  : amount > 0
                    ? "Alles bezahlt – danke!"
                    : "Offen"
            }</span
          >
          <strong>${formatMoney(Math.abs(open))}</strong>
        </div>
      </div>

      ${
        open <= -0.01
          ? html`<p class="banner info">
              <i class="material-icon">info</i>
              <span class="grow"
                >Ihr habt ${formatMoney(-open)} zu viel überwiesen.${
                  contact
                    ? html` Meldet euch bitte bei
                        <a href="mailto:${contact}">${contact}</a>.`
                    : nothing
                }</span
              >
            </p>`
          : nothing
      }
      ${open >= 0.01 ? this.renderTransfer(open) : nothing}

      <p class="banner info">
        <i class="material-icon">schedule</i>
        <span class="grow"
          >Zahlungen werden von uns manuell bestätigt, daher kann die
          „Bezahlt“-Angabe teils mehrere Tage Verzug haben. Schon überwiesen?
          Dann bitte nicht doppelt überweisen.</span
        >
      </p>

      ${this.renderBreakdown(startFees)}`;
  }

  renderTransfer(open: number) {
    const competition = this.competition;
    const club = this.data.club;
    const reference = paymentReference(
      competition?.payment_reference,
      club.name,
      club.code,
    );
    const payload =
      competition?.payment_account_holder && competition.payment_iban
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
    const row = (label: string, value: string | null | undefined) =>
      value
        ? html`<dt>${label}</dt>
            <dd>${value}</dd>
            <dd>
              <button
                class="icon-btn primary"
                title="Kopieren"
                aria-label="${label} kopieren"
                @click=${
                  // eslint-disable-next-line lit/no-template-arrow
                  () => this.copy(label, value)
                }
              >
                ${this.copied === label ? "check" : "content_copy"}
              </button>
            </dd>`
        : nothing;
    return html`<section class="card">
      <header><h3>Überweisung</h3></header>
      <div class="transfer">
        <dl class="bank">
          ${row("Kontoinhaber", competition?.payment_account_holder)}
          ${row("IBAN", competition?.payment_iban)}
          ${row("BIC", competition?.payment_bic)}
          ${row("Verwendungszweck", reference)}
          ${row("Betrag", formatMoney(open))}
          <dt>Zahlungsfrist</dt>
          <dd>
            ${
              competition?.payment_deadline
                ? formatDate(competition.payment_deadline)
                : "wird noch bekannt gegeben"
            }
          </dd>
          <dd></dd>
        </dl>
        ${
          payload
            ? html`<figure>
                <cup-payment-qr .payload=${payload}></cup-payment-qr>
                <figcaption>
                  Mit der Banking-App scannen (GiroCode über
                  ${formatMoney(open)})
                </figcaption>
              </figure>`
            : nothing
        }
      </div>
    </section>`;
  }

  renderBreakdown(amount: number) {
    const competition = this.competition;
    const max = competition?.max_fee_per_starter;
    const riders = this.data.starters.filter(hasStart);
    const groups = (count: number) => (count ? String(count) : "–");
    const rows = riders.map((s) => {
      const fee = getStarterPrice(s, competition);
      const full = (competition?.fee_per_start ?? 0) * countStarts(s);
      return html`<tr>
          <td>${starterName(s)}</td>
          <td class="num">
            ${s.single_female ? "W" : s.single_male ? "M" : "–"}
          </td>
          <td class="num">${s.pair ? "✓" : "–"}</td>
          <td class="num">${groups(s.group_count)}</td>
          <td class="num">
            ${formatMoney(fee)}${
              s.waived_count
                ? html`<br /><small class="muted"
                      >${s.waived_count} erlassen</small
                    >`
                : fee < full
                  ? html`<br /><small class="muted">gedeckelt</small>`
                  : nothing
            }
          </td>
        </tr>`;
    });
    return html`<details
      class="card"
      ?open=${this.detailsOpen}
      @toggle=${this.onDetailsToggle}
    >
      <summary>
        <h3>Aufstellung pro Fahrer</h3>
        <span class="hint"
          >${competition ? formatMoney(competition.fee_per_start) : ""} pro
          Start${
            max === null || max === undefined
              ? ""
              : `, höchstens ${formatMoney(max)} pro Fahrer`
          }</span
        >
        <i class="material-icon chevron">expand_more</i>
      </summary>
      ${
        riders.length === 0
          ? html`<p class="muted">Noch keine Starts.</p>`
          : html`<table>
              <thead>
                <tr>
                  <th>Fahrer</th>
                  <th class="num">Einzel</th>
                  <th class="num">Paar</th>
                  <th class="num">Gruppen</th>
                  <th class="num">Startgeld</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="4">Gesamt</td>
                  <td class="num">${formatMoney(amount)}</td>
                </tr>
              </tfoot>
            </table>`
      }
    </details>`;
  }

  onDetailsToggle(e: Event) {
    this.detailsOpen = (e.target as HTMLDetailsElement).open;
    savePref("payment.detailsOpen", this.detailsOpen);
  }

  async copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.copied = label;
      setTimeout(() => {
        if (this.copied === label) {
          this.copied = null;
        }
      }, 1500);
    } catch {
      // Without clipboard access, the value can still be selected.
    }
  }
}
