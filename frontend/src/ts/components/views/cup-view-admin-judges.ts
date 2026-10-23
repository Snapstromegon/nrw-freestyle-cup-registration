import { Task } from "@lit/task";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { errorMessage, unwrap } from "../../api";
import { client, type schemas } from "../../apiClient";
import { adminStyles } from "../../styles/admin";
import { iconStyles, resetStyles } from "../../styles/base";
import { formatDate } from "../../utils";

type JuryCategory = schemas.JuryCategory;
type JuryCategoryFields = schemas.JuryCategoryFields;
type NumberField =
  | "deployments"
  | "needed_technical"
  | "needed_performance"
  | "needed_dismounts";

/** `editing` value of the add row. */
const NEW = "new";

/** An empty jury category: a heat with the default jury size. */
const newCategory = (): JuryCategoryFields => ({
  name: "",
  deployments: 2,
  day: null,
  needed_technical: 5,
  needed_performance: 5,
  needed_dismounts: 3,
});

const fieldsOf = (category: JuryCategory): JuryCategoryFields => ({
  name: category.name,
  deployments: category.deployments,
  day: category.day ?? null,
  needed_technical: category.needed_technical,
  needed_performance: category.needed_performance,
  needed_dismounts: category.needed_dismounts,
});

/**
 * Jury (/admin-judges): the jury categories judges register for and get
 * assigned to. Only reachable while the jury registration is on.
 */
@customElement("cup-view-admin-judges")
export default class CupViewAdminJudges extends LitElement {
  static override styles = [
    resetStyles,
    iconStyles,
    adminStyles,
    css`
      .toolbar h1 {
        margin: 0 0.5rem 0 0;
      }

      td input {
        width: 100%;
        min-width: 4em;
      }

      td input[type="number"] {
        width: 4.5em;
      }

      td.name input {
        min-width: 14em;
      }
    `,
  ];

  /** Id of the category being edited, `NEW` for the add row, or null. */
  @state() private editing: string | null = null;
  @state() private draft: JuryCategoryFields = newCategory();
  @state() private saving = false;
  @state() private error: string | null = null;

  private categories = new Task(this, {
    args: () => [],
    task: () => unwrap(client.listJuryCategories()),
  });

  override render() {
    return html`<div class="page-pad">
      <div class="toolbar">
        <h1>Jury</h1>
        <span class="spacer"></span>
        <button
          class="btn small primary"
          ?disabled=${this.editing !== null}
          @click=${this.startAdd}
        >
          <span class="material-icon">add</span> Jury-Kategorie
        </button>
      </div>
      ${
        this.error
          ? html`<div class="error-banner" role="alert">
              <span>${this.error}</span>
              <button
                class="icon-btn"
                title="Schließen"
                aria-label="Schließen"
                @click=${this.closeError}
              >
                close
              </button>
            </div>`
          : nothing
      }
      ${this.categories.render({
        pending: () => html`<p class="empty">Lade Jury-Kategorien …</p>`,
        error: (error) =>
          html`<div class="error-banner" role="alert">
            Jury-Kategorien konnten nicht geladen werden:
            ${errorMessage(error)}
          </div>`,
        complete: (categories) => this.renderCategories(categories),
      })}
    </div>`;
  }

  private renderCategories(categories: JuryCategory[]) {
    return html`<h2>Jury-Kategorien</h2>
      <p class="muted small">
        JurorInnen melden sich für Jury-Kategorien an und werden ihnen
        zugeteilt. Ein Vorlauf zählt üblicherweise 2 Juryeinsätze, ein Finale
        1. T, P und A sind die benötigten JurorInnen für Technik, Performance
        und Abstiege.
      </p>
      <table class="dense fit">
        <thead>
          <tr>
            <th>Name</th>
            <th class="num" title="Juryeinsätze, für die sie zählt">
              Einsätze
            </th>
            <th>Tag</th>
            <th class="num" title="Benötigte JurorInnen Technik">T</th>
            <th class="num" title="Benötigte JurorInnen Performance">P</th>
            <th class="num" title="Benötigte AbstiegszählerInnen">A</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${repeat(
            categories,
            (category) => category.id,
            (category, index) =>
              this.editing === category.id
                ? this.renderForm()
                : this.renderRow(categories.length, category, index),
          )}
          ${this.editing === NEW ? this.renderForm() : nothing}
          ${
            categories.length || this.editing === NEW
              ? nothing
              : html`<tr>
                  <td colspan="7" class="empty">
                    Noch keine Jury-Kategorien.
                  </td>
                </tr>`
          }
        </tbody>
      </table>`;
  }

  private renderRow(count: number, category: JuryCategory, index: number) {
    const idle = this.editing === null && !this.saving;
    return html`<tr>
      <td><b>${category.name}</b></td>
      <td class="num">${category.deployments}</td>
      <td>
        ${category.day ? formatDate(category.day) : html`<span class="muted">–</span>`}
      </td>
      <td class="num">${category.needed_technical}</td>
      <td class="num">${category.needed_performance}</td>
      <td class="num">${category.needed_dismounts}</td>
      <td class="nowrap">
        <button
          class="icon-btn"
          title="Nach oben"
          aria-label="${category.name} nach oben"
          data-index=${index}
          data-by="-1"
          ?disabled=${!idle || index === 0}
          @click=${this.onMoveClick}
        >
          arrow_upward
        </button>
        <button
          class="icon-btn"
          title="Nach unten"
          aria-label="${category.name} nach unten"
          data-index=${index}
          data-by="1"
          ?disabled=${!idle || index === count - 1}
          @click=${this.onMoveClick}
        >
          arrow_downward
        </button>
        <button
          class="icon-btn"
          title="Bearbeiten"
          aria-label="${category.name} bearbeiten"
          data-index=${index}
          ?disabled=${!idle}
          @click=${this.onEditClick}
        >
          edit
        </button>
        <button
          class="icon-btn"
          title="Löschen"
          aria-label="${category.name} löschen"
          data-index=${index}
          ?disabled=${!idle}
          @click=${this.onDeleteClick}
        >
          delete
        </button>
      </td>
    </tr>`;
  }

  private renderForm() {
    const draft = this.draft;
    const number = (key: NumberField, label: string) =>
      html`<td class="num">
        <input
          type="number"
          min="0"
          step="1"
          required
          aria-label=${label}
          data-key=${key}
          .value=${String(draft[key])}
          @input=${this.onNumberInput}
        />
      </td>`;
    return html`<tr class="editing">
      <td class="name">
        <input
          type="text"
          required
          aria-label="Name"
          placeholder="z. B. Einzel W – Junior Expert Vorlauf"
          .value=${draft.name}
          @input=${this.onNameInput}
          @keydown=${this.onKeydown}
        />
      </td>
      ${number("deployments", "Einsätze")}
      <td>
        <input
          type="date"
          aria-label="Tag"
          .value=${draft.day ?? ""}
          @input=${this.onDayInput}
        />
      </td>
      ${number("needed_technical", "Benötigte JurorInnen Technik")}
      ${number("needed_performance", "Benötigte JurorInnen Performance")}
      ${number("needed_dismounts", "Benötigte AbstiegszählerInnen")}
      <td class="nowrap">
        <button
          class="icon-btn primary"
          title="Speichern"
          aria-label="Speichern"
          ?disabled=${this.saving || !draft.name.trim()}
          @click=${this.save}
        >
          check
        </button>
        <button
          class="icon-btn"
          title="Abbrechen"
          aria-label="Abbrechen"
          ?disabled=${this.saving}
          @click=${this.cancel}
        >
          close
        </button>
      </td>
    </tr>`;
  }

  /** The category of a row button, from its `data-index`. */
  private categoryOf(e: Event) {
    const index = Number((e.currentTarget as HTMLElement).dataset.index);
    return this.categories.value?.[index];
  }

  private onNameInput(e: InputEvent) {
    this.draft = { ...this.draft, name: (e.target as HTMLInputElement).value };
  }

  private onDayInput(e: InputEvent) {
    const day = (e.target as HTMLInputElement).value;
    this.draft = { ...this.draft, day: day || null };
  }

  private onNumberInput(e: InputEvent) {
    const input = e.target as HTMLInputElement;
    const key = input.dataset.key as NumberField;
    this.draft = { ...this.draft, [key]: Number(input.value) };
  }

  private onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      this.cancel();
    } else if (e.key === "Enter") {
      void this.save();
    }
  }

  private startAdd() {
    this.draft = newCategory();
    this.editing = NEW;
  }

  private onEditClick(e: Event) {
    const category = this.categoryOf(e);
    if (category) {
      this.draft = fieldsOf(category);
      this.editing = category.id;
    }
  }

  private cancel() {
    this.editing = null;
  }

  private closeError() {
    this.error = null;
  }

  private async save() {
    const id = this.editing;
    if (!id || !this.draft.name.trim()) {
      return;
    }
    await this.change(
      () =>
        id === NEW
          ? unwrap(client.addJuryCategory({ body: this.draft }))
          : unwrap(client.editJuryCategory({ body: { ...this.draft, id } })),
      "Speichern",
    );
  }

  private async onDeleteClick(e: Event) {
    const category = this.categoryOf(e);
    if (!category || !confirm(`Jury-Kategorie „${category.name}“ löschen?`)) {
      return;
    }
    await this.change(
      () => unwrap(client.deleteJuryCategory({ body: { id: category.id } })),
      "Löschen",
    );
  }

  private async onMoveClick(e: Event) {
    const button = e.currentTarget as HTMLElement;
    const index = Number(button.dataset.index);
    const other = index + Number(button.dataset.by);
    const ids = (this.categories.value ?? []).map((c) => c.id);
    if (other < 0 || other >= ids.length) {
      return;
    }
    [ids[index], ids[other]] = [ids[other], ids[index]];
    await this.change(
      () => unwrap(client.setJuryCategoryOrder({ body: { ids } })),
      "Verschieben",
    );
  }

  /** Runs a change, then reloads; a failure is shown above the table. */
  private async change(run: () => Promise<unknown>, action: string) {
    this.saving = true;
    try {
      await run();
      this.error = null;
      this.editing = null;
      await this.categories.run();
    } catch (error) {
      this.error = `${action} fehlgeschlagen: ${errorMessage(error)}`;
    } finally {
      this.saving = false;
    }
  }
}
