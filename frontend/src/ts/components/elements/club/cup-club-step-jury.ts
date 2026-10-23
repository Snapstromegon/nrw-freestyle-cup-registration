import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { errorMessage, unwrap } from "../../../api";
import { client, type schemas } from "../../../apiClient";
import {
  type ClubData,
  type ClubJudge,
  type JuryCategory,
  starterName,
} from "../../../club-data";
import { ageOnStart, ROLES, roleLabels, roleNames } from "../../../jury";
import { iconStyles, resetStyles } from "../../../styles/base";
import { clubPortalStyles } from "../../../styles/club-portal";
import { type Competition, formatDate, formatMoney } from "../../../utils";
import { dataChanged } from "./events";

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
  birthdate: judge.birthdate.slice(0, 10),
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

      table.grid th,
      table.grid td {
        text-align: center;
      }

      table.grid th:first-child,
      table.grid td:first-child {
        text-align: left;
      }

      .registrations {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
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
        <span class="grow"
          >Geschulte JurorInnen (IUF-Rulebook) müssen am ersten Wettkampftag
          mindestens ${rules?.min_age ?? 15} Jahre alt sein. Nicht geschulte
          Personen können als AbstiegszählerInnen gemeldet werden, zählen aber
          nicht für die Pflicht-Juryeinsätze. Mit der Anmeldung erklären die
          gemeldeten JurorInnen, dass sie mit der Speicherung und
          Veröffentlichung der wettkampfrelevanten personenbezogenen Daten
          sowie Fotos und Videos, die im Zusammenhang mit dieser Veranstaltung
          entstehen, einverstanden sind.</span
        >
      </p>
      ${this.renderObligation()}
      ${
        this.error
          ? html`<p class="banner error" role="alert">${this.error}</p>`
          : nothing
      }
      ${
        this.canRegister && this.editing === null
          ? html`<div class="next-step">
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
            : html`<table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Alter</th>
                    <th>Wertet</th>
                    <th><span class="visually-hidden">Aktionen</span></th>
                  </tr>
                </thead>
                <tbody>
                  ${repeat(
                    this.judges,
                    (judge) => judge.id,
                    (judge) =>
                      this.editing === judge.id
                        ? html`<tr>
                            <td colspan="4">${this.renderForm()}</td>
                          </tr>`
                        : this.renderJudge(judge),
                  )}
                </tbody>
              </table>`
        }
      </section>`;
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
          judge.is_trained
            ? html`<span class="chip">geschult</span>`
            : html`<span class="chip warn">AbstiegszählerIn</span>`
        }
        ${
          judge.note
            ? html`<br /><small class="muted">${judge.note}</small>`
            : nothing
        }
      </td>
      <td>${ageOnStart(judge.birthdate, this.competition) ?? ""}</td>
      <td>
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
          ${
            judge.max_deployments
              ? html`<span class="chip">max. ${judge.max_deployments} Einsätze</span>`
              : nothing
          }
        </div>
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
      (role) => html`<th title=${roleNames[role]}>${roleLabels[role]}</th>`,
    );
    return html`<table class="grid">
      <thead>
        <tr>
          <th>Jury-Kategorie</th>
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
    </table>`;
  }

  private renderGridRow(category: JuryCategory) {
    const cells = ROLES.map(
      (role) =>
        html`<td>
            <input
              type="checkbox"
              aria-label="${category.name}: ${roleNames[role]}"
              data-key=${key(category.id, role)}
              .checked=${this.draft.registrations.has(key(category.id, role))}
              ?disabled=${!this.draft.is_trained && role !== "dismounts"}
              @change=${this.onRegistrationChange}
            />
          </td>`,
    );
    return html`<tr>
      <td>
        ${category.name}
        ${
          category.day
            ? html`<span class="muted">(${formatDate(category.day)})</span>`
            : nothing
        }
      </td>
      ${cells}
    </tr>`;
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
