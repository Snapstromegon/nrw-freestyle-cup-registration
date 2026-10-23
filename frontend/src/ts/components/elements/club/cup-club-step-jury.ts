import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { errorMessage, unwrap } from "../../../api";
import { client, type schemas } from "../../../apiClient";
import {
  type ClubData,
  type ClubJudge,
  type JuryCategory,
  starterName,
} from "../../../club-data";
import {
  ageOnStart,
  countDeployments,
  deploymentNote,
  obligationTone,
  ROLES,
  roleLabels,
  roleNames,
} from "../../../jury";
import { iconStyles, resetStyles } from "../../../styles/base";
import { clubPortalStyles } from "../../../styles/club-portal";
import {
  type Competition,
  dateInputValue,
  formatDate,
  formatMoney,
} from "../../../utils";
import { dataChanged, navigateTo } from "./events";

type JudgeRole = schemas.JudgeRole;

/** The judge form, as the inputs hold it. */
interface Draft {
  firstname: string;
  lastname: string;
  /** "YYYY-MM-DD". */
  birthdate: string;
  is_trained: boolean;
  /** Empty for no limit. */
  max_deployments: string;
  note: string;
  /** "categoryId:role" of every ticked box. */
  registrations: Set<string>;
}

const emptyDraft = (): Draft => ({
  firstname: "",
  lastname: "",
  birthdate: "",
  is_trained: true,
  max_deployments: "",
  note: "",
  registrations: new Set(),
});

const key = (categoryId: string, role: JudgeRole) => `${categoryId}:${role}`;

const draftOf = (judge: ClubJudge): Draft => ({
  firstname: judge.firstname,
  lastname: judge.lastname,
  birthdate: dateInputValue(judge.birthdate),
  is_trained: judge.is_trained,
  max_deployments: judge.max_deployments?.toString() ?? "",
  note: judge.note ?? "",
  registrations: new Set(
    judge.registrations.map((r) => key(r.jury_category_id, r.role)),
  ),
});

/** `editing` value of the add form. */
const NEW = "new";

/**
 * Step "Jury": the club's judges (JurorInnen) and the jury categories and
 * roles they can do. Only shown while the jury registration is on.
 */
@customElement("cup-club-step-jury")
export default class CupClubStepJury extends LitElement {
  static override styles = [
    resetStyles,
    iconStyles,
    clubPortalStyles,
    css`
      .judge-form {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: flex-end;
      }

      .judge-form .field {
        flex: 1 1 12rem;
      }

      .judge-form .field.wide {
        flex-basis: 100%;
      }

      .judge-form label.check {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex: 1 1 12rem;
      }

      .add-judge {
        margin-bottom: 1rem;
      }

      /* The judges and the published plan, like the riders table. */
      table.list {
        width: 100%;
        border-collapse: collapse;
      }

      table.list > thead > tr > th {
        padding: 0.5rem;
        border-bottom: 1px solid var(--cup-border);
        color: var(--cup-muted);
        font-size: 0.8rem;
        font-weight: 600;
        text-align: left;
      }

      table.list > * > tr > td {
        padding: 0.5rem;
        border-bottom: 1px solid var(--cup-border);
        vertical-align: middle;
      }

      table.list > tfoot > tr > td {
        background: var(--cup-surface-2);
        border-top: 2px solid var(--cup-border);
        border-bottom: none;
        font-weight: 600;
      }

      table.list > * > tr > td.name {
        font-weight: 600;
        white-space: nowrap;
      }

      table.list > * > tr > td.name small {
        display: block;
        font-weight: normal;
        white-space: normal;
      }

      table.list > thead > tr > th.icon,
      table.list > * > tr > td.icon {
        width: 2.5rem;
        text-align: center;
      }

      table.list > thead > tr > th.icon .material-icon {
        font-size: 1.15rem;
        vertical-align: middle;
      }

      table.list .material-icon.trained {
        color: var(--cup-green);
      }

      table.list > thead > tr > th.num,
      table.list > * > tr > td.num {
        text-align: right;
      }

      .sum {
        padding: 0.125rem 0.5rem;
        border-radius: 0.375rem;
        white-space: nowrap;
      }

      .sum.none {
        background: color-mix(in srgb, var(--cup-red) 20%, var(--cup-surface));
        color: var(--cup-red);
      }

      .sum.below {
        background: color-mix(in srgb, var(--cup-amber) 30%, var(--cup-surface));
        color: color-mix(in srgb, var(--cup-amber) 70%, var(--cup-text));
      }

      .sum.met {
        background: color-mix(in srgb, var(--cup-green) 20%, var(--cup-surface));
        color: var(--cup-green);
      }

      table.list .unit {
        display: none;
      }

      /* Phones: each judge as a small card, like the riders. */
      @media (max-width: 720px) {
        table.judges > thead {
          display: none;
        }

        table.judges,
        table.judges > tbody,
        table.judges > tfoot,
        table.judges > * > tr,
        table.judges > * > tr > td {
          display: block;
        }

        table.judges > tbody > tr {
          display: grid;
          grid-template-columns: 1fr auto auto;
          grid-template-areas:
            "name icon actions"
            "age count count"
            "regs regs regs";
          gap: 0.25rem 0.5rem;
          padding: 0.75rem 0;
          border-bottom: 1px solid var(--cup-border);
        }

        table.judges > tbody > tr > td {
          padding: 0;
          border: none;
        }

        table.judges > tbody > tr.editing {
          display: block;
        }

        table.judges > tbody > tr > td.name {
          grid-area: name;
          white-space: normal;
        }

        table.judges > tbody > tr > td.icon {
          grid-area: icon;
          width: auto;
        }

        table.judges > tbody > tr > td.actions-col {
          grid-area: actions;
        }

        table.judges > tbody > tr > td.age {
          grid-area: age;
          color: var(--cup-muted);
          font-size: 0.9rem;
        }

        table.judges .unit {
          display: inline;
        }

        table.judges > tbody > tr > td.deployments {
          grid-area: count;
        }

        table.judges > tbody > tr > td.regs {
          grid-area: regs;
        }

        table.judges > tfoot > tr {
          display: flex;
          justify-content: space-between;
          background: var(--cup-surface-2);
          border-top: 2px solid var(--cup-border);
        }

        table.judges > tfoot > tr > td:empty {
          display: none;
        }

        table.judges > tfoot > tr > td {
          border: none;
          background: none;
        }
      }

      .progress {
        position: relative;
        height: 1.75rem;
        margin: -0.25rem 0 0.75rem;
        border-radius: 0.5rem;
        border: 1px solid var(--cup-border);
        background: var(--cup-surface);
        overflow: hidden;
      }

      /* Light fills, so the label on top stays readable. */
      .progress .bar {
        height: 100%;
        background: color-mix(in srgb, var(--cup-amber) 35%, var(--cup-surface));
      }

      .progress .bar.full {
        background: color-mix(in srgb, var(--cup-green) 35%, var(--cup-surface));
      }

      .progress span {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.875rem;
        font-weight: 600;
      }

      td.deployments small {
        display: block;
        white-space: nowrap;
      }

      /* Jury categories × roles in the judge form. */
      .grid-wrap {
        flex: 1 1 100%;
        overflow-x: auto;
        border: 1px solid var(--cup-border);
        border-radius: 0.5rem;
      }

      table.grid {
        width: 100%;
        border-collapse: collapse;
      }

      table.grid th {
        padding: 0.5rem 0.75rem;
        background: var(--cup-surface-2);
        color: var(--cup-muted);
        font-size: 0.8rem;
        font-weight: 600;
        text-align: left;
      }

      table.grid th.role {
        width: 5.5rem;
        text-align: center;
      }

      table.grid th.role abbr {
        display: block;
        color: var(--cup-blue);
        font-size: 1rem;
        text-decoration: none;
      }

      table.grid td {
        padding: 0;
        border-top: 1px solid var(--cup-border);
      }

      table.grid tbody tr:nth-child(even) {
        background: color-mix(in srgb, var(--cup-surface-2) 50%, transparent);
      }

      table.grid tbody tr:hover {
        background: color-mix(in srgb, var(--cup-blue-2) 20%, transparent);
      }

      table.grid td.category {
        padding: 0.5rem 0.75rem;
      }

      table.grid th.count,
      table.grid td.count {
        width: 5rem;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }

      table.grid td.count {
        color: var(--cup-muted);
      }

      table.grid tfoot td {
        border-top: 2px solid var(--cup-border);
        background: var(--cup-surface-2);
        font-weight: 600;
      }

      table.grid tfoot td.count {
        color: var(--cup-blue);
        font-size: 1.1rem;
      }

      table.grid td.category small {
        display: block;
        color: var(--cup-muted);
      }

      /* The whole cell toggles the role. */
      table.grid td.role label {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 2.75rem;
        cursor: pointer;
      }

      table.grid td.role input {
        width: 1.15rem;
        height: 1.15rem;
        accent-color: var(--cup-blue);
        cursor: inherit;
      }

      table.grid td.role.off label {
        cursor: not-allowed;
        opacity: 0.35;
      }

      .registrations {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }

      /* Long category names wrap instead of widening the page. */
      .registrations .chip {
        white-space: normal;
      }


    `,
  ];

  @property({ attribute: false }) data!: ClubData;
  @property({ attribute: false }) competition: Competition | null = null;
  @property({ type: Boolean, attribute: "can-register" }) canRegister = false;

  /** Id of the judge being edited, `NEW` for the add form, or null. */
  @state() private editing: string | null = null;
  @state() private draft: Draft = emptyDraft();
  @state() private saving = false;
  @state() private error: string | null = null;

  private get judges() {
    return this.data.judges ?? [];
  }

  private get categories() {
    return this.data.juryCategories ?? [];
  }

  override render() {
    const rules = this.competition?.jury;
    const trained = this.judges.filter((j) => j.is_trained).length;
    return html`<div class="step-intro">
        <h2>4. Jury</h2>
        <p>
          Meldet eure JurorInnen und wofür sie werten können. Die Juryleitung
          teilt sie danach den Wertungen zu.
        </p>
      </div>

      <p class="banner info">
        <i class="material-icon">gavel</i>
        <span class="grow">${this.infoText(rules?.min_age ?? 15)}</span>
      </p>
      ${this.renderObligation()}
      ${
        this.error
          ? html`<p class="banner error" role="alert">${this.error}</p>`
          : nothing
      }
      ${
        this.canRegister && this.editing === null
          ? html`<div class="next-step add-judge">
              <button class="btn primary" @click=${this.startAdd}>
                <i class="material-icon">person_add</i> JurorIn hinzufügen
              </button>
            </div>`
          : nothing
      }
      ${this.editing === NEW ? this.renderForm() : nothing}

      <section class="card">
        <header>
          <h3>
            ${this.judges.length}
            ${this.judges.length === 1 ? "JurorIn" : "JurorInnen"}
          </h3>
          <span class="hint"
            >${trained} geschult · ${this.judges.length - trained}
            AbstiegszählerInnen</span
          >
        </header>
        ${
          this.judges.length === 0
            ? html`<div class="empty">
                <i class="material-icon">gavel</i>
                <strong>Noch keine JurorInnen</strong>
              </div>`
            : html`<table class="list judges">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th class="icon" title="Geschult (IUF-Rulebook)">
                      <i class="material-icon" aria-hidden="true">school</i>
                      <span class="visually-hidden">Geschult</span>
                    </th>
                    <th>Alter</th>
                    <th>Wertet</th>
                    <th class="num" title="Juryeinsätze, die für euren Verein zählen">
                      Einsätze
                    </th>
                    <th><span class="visually-hidden">Aktionen</span></th>
                  </tr>
                </thead>
                <tbody>
                  ${repeat(
                    this.judges,
                    (judge) => judge.id,
                    (judge) =>
                      this.editing === judge.id
                        ? html`<tr class="editing">
                            <td colspan="6">${this.renderForm()}</td>
                          </tr>`
                        : this.renderJudge(judge),
                  )}
                </tbody>
                ${this.renderTotal()}
              </table>`
        }
      </section>
      ${this.renderPlan()}

      <div class="next-step">
        <button class="btn blue" @click=${this.goToPayment}>
          Weiter: Startgeld <i class="material-icon">arrow_forward</i>
        </button>
      </div>`;
  }

  private goToPayment() {
    navigateTo(this, { step: "startgeld" });
  }

  /** The rules and the Ausschreibung's consent, as one line of text. */
  private infoText(minAge: number) {
    return (
      `Geschulte JurorInnen (IUF-Rulebook) müssen am ersten Wettkampftag mindestens ${minAge} Jahre alt sein. ` +
      "Nicht geschulte Personen können als AbstiegszählerInnen gemeldet werden, zählen aber nicht für die Pflicht-Juryeinsätze. " +
      "Mit der Anmeldung erklären die gemeldeten JurorInnen, dass sie mit der Speicherung und Veröffentlichung der wettkampfrelevanten " +
      "personenbezogenen Daten sowie Fotos und Videos, die im Zusammenhang mit dieser Veranstaltung entstehen, einverstanden sind."
    );
  }

  /** The club's judges' assignments, once the Juryplan is published. */
  private renderPlan() {
    const plan = this.data.juryPlan;
    if (!plan?.published_at) {
      return nothing;
    }
    const categories = new Map(this.categories.map((c) => [c.id, c]));
    const judges = new Map(this.judges.map((j) => [j.id, j]));
    const rows = plan.assignments.map((a) => {
      const category = categories.get(a.jury_category_id);
      const judge = judges.get(a.judge_id);
      return html`<tr>
        <td>${judge ? starterName(judge) : "?"}</td>
        <td>
          ${category?.name ?? "?"}
          ${
            category?.day
              ? html`<span class="muted">(${formatDate(category.day)})</span>`
              : nothing
          }
        </td>
        <td>${roleNames[a.role]}</td>
      </tr>`;
    });
    return html`<section class="card">
      <header>
        <h3>Juryplan</h3>
        <span class="hint">Stand ${formatDate(plan.published_at)}</span>
      </header>
      ${
        rows.length
          ? html`<table class="list">
              <thead>
                <tr>
                  <th>JurorIn</th>
                  <th>Jury-Kategorie</th>
                  <th>Rolle</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>`
          : html`<p class="muted">Eure JurorInnen sind nicht eingeteilt.</p>`
      }
      <p class="muted small">
        Der Juryplan kann sich noch ändern. Bei Krankheit meldet sich die
        JurorIn bitte schnellstmöglich bei der Juryleitung.
      </p>
    </section>`;
  }

  /** How much of the obligation the club has filled, as a bar. */
  private renderProgress(credited: number, required: number) {
    if (!required) {
      return nothing;
    }
    const share = Math.min(1, credited / required);
    return html`<div
      class="progress"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax=${required}
      aria-valuenow=${credited}
      aria-label="Gemeldete Pflicht-Juryeinsätze"
    >
      <div
        class="bar ${credited >= required ? "full" : ""}"
        style=${styleMap({ width: `${share * 100}%` })}
      ></div>
      <span>${credited} von ${required} Pflicht-Juryeinsätzen gemeldet</span>
    </div>`;
  }

  /** Sum of the judges' Einsätze against the club's obligation. */
  private renderTotal() {
    const jury = this.data.club.jury;
    const counted = this.judges.reduce(
      (sum, j) => sum + j.counted_deployments,
      0,
    );
    const override =
      jury?.credited_override !== null && jury?.credited_override !== undefined;
    return html`<tfoot>
      <tr>
        <td colspan="4">
          Gesamt${
            override
              ? html` · vom Veranstalter angerechnet (gemeldet: ${counted})`
              : nothing
          }
        </td>
        <td class="num">
          ${
            jury?.required
              ? html`<strong class="sum ${obligationTone(jury.credited, jury.required)}"
                  >${jury.credited}/${jury.required}</strong
                >`
              : html`<strong>${counted}</strong>`
          }
        </td>
        <td></td>
      </tr>
    </tfoot>`;
  }

  /** Küren, required and credited Einsätze, and the fee for missing ones. */
  private renderObligation() {
    const jury = this.data.club.jury;
    const rules = this.competition?.jury;
    if (!jury || !rules) {
      return nothing;
    }
    return html`<div class="tiles">
        <div class="tile">
          <span>Küren</span><strong>${jury.acts}</strong>
        </div>
        <div class="tile">
          <span>Pflicht-Juryeinsätze</span><strong>${jury.required}</strong>
        </div>
        <div
          class="tile"
          title=${
            jury.credited_override === null ||
            jury.credited_override === undefined
              ? "Von euren geschulten JurorInnen gemeldet"
              : `Vom Veranstalter angerechnet (gemeldet: ${jury.registered})`
          }
        >
          <span>Gemeldete Einsätze</span><strong>${jury.credited}</strong>
        </div>
        <div class="tile ${jury.missing ? "open" : jury.required ? "done" : ""}">
          <span
            >${
              jury.missing
                ? `${jury.missing} fehlen · Jurygebühr`
                : "Pflicht erfüllt"
            }</span
          >
          <strong
            >${jury.missing ? formatMoney(jury.fee) : "✓"}</strong
          >
        </div>
      </div>
      ${this.renderProgress(jury.credited, jury.required)}
      <p class="muted small">
        Pro angefangene 2 Küren sind ${rules.deployments_per_two_acts}
        Juryeinsätze zu melden; jeder fehlende kostet
        ${formatMoney(rules.missing_deployment_fee)} und wird mit dem Startgeld
        bezahlt. Gezählt werden die Einsätze der Jury-Kategorien, für die eure
        geschulten JurorInnen gemeldet sind, höchstens ihre max. Einsätze.
      </p>`;
  }

  private renderJudge(judge: ClubJudge) {
    const categories = new Map(this.categories.map((c) => [c.id, c.name]));
    const byCategory = new Map<string, JudgeRole[]>();
    for (const r of judge.registrations) {
      byCategory.set(r.jury_category_id, [
        ...(byCategory.get(r.jury_category_id) ?? []),
        r.role,
      ]);
    }
    return html`<tr>
      <td class="name">
        ${starterName(judge)}
        ${
          judge.note
            ? html`<small class="muted">${judge.note}</small>`
            : nothing
        }
      </td>
      <td
        class="icon"
        title=${
          judge.is_trained
            ? "Geschult (IUF-Rulebook)"
            : "Nicht geschult: nur AbstiegszählerIn"
        }
      >
        ${
          judge.is_trained
            ? html`<i class="material-icon trained" aria-label="geschult">school</i>`
            : html`<span class="muted" aria-label="nicht geschult">–</span>`
        }
      </td>
      <td class="age">
        ${ageOnStart(judge.birthdate, this.competition) ?? ""}
        <span class="unit">Jahre</span>
      </td>
      <td class="regs">
        <div class="registrations">
          ${
            byCategory.size === 0
              ? html`<span class="muted">nichts gewählt</span>`
              : [...byCategory].map(
                  ([id, roles]) =>
                    html`<span class="chip"
                      >${categories.get(id) ?? "?"}:
                      ${roles.map((r) => roleLabels[r]).join("/")}</span
                    >`,
                )
          }
        </div>
      </td>
      <td class="num deployments">
        <strong>${judge.counted_deployments}</strong>
        ${
          deploymentNote(judge)
            ? html`<small class="muted">${deploymentNote(judge)}</small>`
            : nothing
        }
      </td>
      <td class="actions-col">
        ${
          this.canRegister
            ? html`<button
                  class="icon-btn"
                  title="Bearbeiten"
                  aria-label="${starterName(judge)} bearbeiten"
                  data-id=${judge.id}
                  ?disabled=${this.editing !== null || this.saving}
                  @click=${this.onEditClick}
                >
                  edit
                </button>
                <button
                  class="icon-btn"
                  title="Entfernen"
                  aria-label="${starterName(judge)} entfernen"
                  data-id=${judge.id}
                  ?disabled=${this.editing !== null || this.saving}
                  @click=${this.onDeleteClick}
                >
                  delete
                </button>`
            : nothing
        }
      </td>
    </tr>`;
  }

  private renderForm() {
    const draft = this.draft;
    return html`<section class="card">
      <header>
        <h3>${this.editing === NEW ? "JurorIn hinzufügen" : "JurorIn bearbeiten"}</h3>
      </header>
      <form class="judge-form" @submit=${this.save}>
        <label class="field"
          ><span>Vorname</span
          ><input
            type="text"
            required
            autocomplete="off"
            data-field="firstname"
            .value=${draft.firstname}
            @input=${this.onTextInput}
        /></label>
        <label class="field"
          ><span>Nachname</span
          ><input
            type="text"
            required
            autocomplete="off"
            data-field="lastname"
            .value=${draft.lastname}
            @input=${this.onTextInput}
        /></label>
        <label class="field"
          ><span>Geburtsdatum</span
          ><input
            type="date"
            required
            data-field="birthdate"
            .value=${draft.birthdate}
            @input=${this.onTextInput}
        /></label>
        <label class="field"
          ><span>Max. Einsätze (optional)</span
          ><input
            type="number"
            min="1"
            step="1"
            data-field="max_deployments"
            .value=${draft.max_deployments}
            @input=${this.onTextInput}
        /></label>
        <label class="check"
          ><input
            type="checkbox"
            .checked=${draft.is_trained}
            @change=${this.onTrainedChange}
          />
          geschult (IUF-Rulebook)</label
        >
        <label class="field wide"
          ><span>Notiz für die Juryleitung (optional)</span
          ><input
            type="text"
            data-field="note"
            .value=${draft.note}
            @input=${this.onTextInput}
        /></label>
        ${this.renderGrid()}
        <div class="actions">
          <button class="btn primary" ?disabled=${this.saving}>
            <i class="material-icon">save</i> Speichern
          </button>
          <button
            type="button"
            class="btn"
            ?disabled=${this.saving}
            @click=${this.cancel}
          >
            Abbrechen
          </button>
        </div>
      </form>
    </section>`;
  }

  /** Jury categories × roles; untrained people only count dismounts. */
  private renderGrid() {
    if (this.categories.length === 0) {
      return html`<p class="muted">Noch keine Jury-Kategorien angelegt.</p>`;
    }
    const headers = ROLES.map(
      (role) =>
        html`<th class="role" scope="col">
          <abbr title=${roleNames[role]}>${roleLabels[role]}</abbr>
          ${roleNames[role]}
        </th>`,
    );
    return html`<div class="grid-wrap">
      <table class="grid">
        <thead>
          <tr>
            <th scope="col">Wofür kann die JurorIn werten?</th>
            <th class="count" scope="col" title="Juryeinsätze, für die die Kategorie zählt">
              Einsätze
            </th>
            ${headers}
          </tr>
        </thead>
        <tbody>
          ${repeat(
            this.categories,
            (category) => category.id,
            (category) => this.renderGridRow(category),
          )}
        </tbody>
        ${this.renderGridTotal()}
      </table>
    </div>`;
  }

  private renderGridRow(category: JuryCategory) {
    const cells = ROLES.map((role) => {
      const off = !this.draft.is_trained && role !== "dismounts";
      return html`<td
        class="role ${off ? "off" : ""}"
        title=${off ? "Nur für geschulte JurorInnen" : roleNames[role]}
      >
        <label>
          <input
            type="checkbox"
            aria-label="${category.name}: ${roleNames[role]}"
            data-key=${key(category.id, role)}
            .checked=${this.draft.registrations.has(key(category.id, role))}
            ?disabled=${off}
            @change=${this.onRegistrationChange}
          />
        </label>
      </td>`;
    });
    return html`<tr>
      <td class="category">
        ${category.name}
        ${category.day ? html`<small>${formatDate(category.day)}</small>` : nothing}
      </td>
      <td class="count">${category.deployments}</td>
      ${cells}
    </tr>`;
  }

  /** What the current selection is worth for the club, while editing. */
  private renderGridTotal() {
    const draft = this.draft;
    const max = draft.max_deployments ? Number(draft.max_deployments) : null;
    const { registered, counted } = countDeployments(
      this.categories,
      draft.registrations,
      draft.is_trained,
      max,
    );
    const note = deploymentNote({
      is_trained: draft.is_trained,
      registered_deployments: registered,
      counted_deployments: counted,
      max_deployments: max,
    });
    return html`<tfoot>
      <tr>
        <td class="category">
          Zählt für euren Verein
          ${note ? html`<small>${note}</small>` : nothing}
        </td>
        <td class="count"><strong>${counted}</strong></td>
        <td colspan=${ROLES.length}></td>
      </tr>
    </tfoot>`;
  }

  private onTextInput(e: InputEvent) {
    const input = e.target as HTMLInputElement;
    const field = input.dataset.field as keyof Draft;
    this.draft = { ...this.draft, [field]: input.value };
  }

  private onTrainedChange(e: Event) {
    const isTrained = (e.target as HTMLInputElement).checked;
    // Untrained people only count dismounts.
    const registrations = new Set(
      [...this.draft.registrations].filter(
        (k) => isTrained || k.endsWith(":dismounts"),
      ),
    );
    this.draft = { ...this.draft, is_trained: isTrained, registrations };
  }

  private onRegistrationChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const registrations = new Set(this.draft.registrations);
    if (input.checked) {
      registrations.add(input.dataset.key!);
    } else {
      registrations.delete(input.dataset.key!);
    }
    this.draft = { ...this.draft, registrations };
  }

  private judgeOf(e: Event) {
    const id = (e.currentTarget as HTMLElement).dataset.id;
    return this.judges.find((judge) => judge.id === id);
  }

  private startAdd() {
    this.draft = emptyDraft();
    this.editing = NEW;
  }

  private onEditClick(e: Event) {
    const judge = this.judgeOf(e);
    if (judge) {
      this.draft = draftOf(judge);
      this.editing = judge.id;
    }
  }

  private cancel() {
    this.editing = null;
    this.error = null;
  }

  private async save(e: SubmitEvent) {
    e.preventDefault();
    const draft = this.draft;
    const fields = {
      firstname: draft.firstname,
      lastname: draft.lastname,
      birthdate: `${draft.birthdate}T00:00:00.000Z`,
      is_trained: draft.is_trained,
      max_deployments: draft.max_deployments
        ? Number(draft.max_deployments)
        : null,
      note: draft.note || null,
      registrations: [...draft.registrations].map((k) => {
        const [jury_category_id, role] = k.split(":");
        return { jury_category_id, role: role as JudgeRole };
      }),
    };
    const id = this.editing;
    await this.change(
      () =>
        id === NEW
          ? unwrap(
              client.addClubJudge({
                body: { ...fields, club_id: this.data.club.id },
              }),
            )
          : unwrap(
              client.editClubJudge({ body: { ...fields, judge_id: id! } }),
            ),
      "Speichern",
    );
  }

  private async onDeleteClick(e: Event) {
    const judge = this.judgeOf(e);
    if (!judge || !confirm(`${starterName(judge)} als JurorIn entfernen?`)) {
      return;
    }
    await this.change(
      () => unwrap(client.deleteClubJudge({ body: { judge_id: judge.id } })),
      "Entfernen",
    );
  }

  /** Runs a change and reloads the portal; a failure is shown on top. */
  private async change(run: () => Promise<unknown>, action: string) {
    this.saving = true;
    try {
      await run();
      this.error = null;
      this.editing = null;
      dataChanged(this);
    } catch (error) {
      this.error = `${action} fehlgeschlagen: ${errorMessage(error)}`;
    } finally {
      this.saving = false;
    }
  }
}
