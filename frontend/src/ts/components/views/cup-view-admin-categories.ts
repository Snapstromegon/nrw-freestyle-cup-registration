import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { Task } from "@lit/task";
import { repeat } from "lit/directives/repeat.js";

@customElement("cup-view-admin-categories")
export default class CupViewAdminCategories extends LitElement {
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

    table {
      border-collapse: collapse;
      width: 100%;
    }

    td,
    th {
      padding: 0.5rem;
      border: 1px solid #ccc;
    }

    th {
      background-color: #f5f5f5;
    }

    tr:nth-child(odd) td {
      background-color: #0001;
    }

    tr:hover td,
    tr:hover th {
      background-color: #0002;
    }

    .right {
      text-align: right;
    }

    nav a {
      padding: 0.5rem;
      display: inline-block;
    }

    .form-container {
      background-color: #f9f9f9;
      padding: 1rem;
      margin: 1rem 0;
      border: 1px solid #ddd;
      border-radius: 4px;
    }

    .form-row {
      display: flex;
      gap: 1rem;
      margin-bottom: 0.5rem;
      align-items: center;
    }

    .form-row label {
      min-width: 150px;
    }

    .form-row input,
    .form-row textarea {
      flex: 1;
      padding: 0.25rem;
    }

    .form-row input[type="checkbox"] {
      flex: none;
    }

    .actions {
      display: flex;
      gap: 0.5rem;
    }

    button {
      padding: 0.5rem 1rem;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .delete-btn {
      background-color: #dc3545;
      color: white;
      border: none;
    }

    .edit-btn {
      background-color: #007bff;
      color: white;
      border: none;
    }

    .save-btn {
      background-color: #28a745;
      color: white;
      border: none;
    }

    .cancel-btn {
      background-color: #6c757d;
      color: white;
      border: none;
    }
  `;

  @state()
  private editingCategory: string | null = null;

  @state()
  private newCategory: Partial<
    components["schemas"]["Category"] & { new_name: string }
  > = {};

  @state()
  private editForm: Partial<
    components["schemas"]["Category"] & { new_name: string }
  > = {};

  @state()
  private showNewForm = false;

  categories = new Task(this, {
    args: () => [],
    task: async () => {
      const data = await client.GET("/api/query/list_categories");
      if (data.error) {
        throw new Error((data.error as { message: string }).message);
      }
      return data.data || [];
    },
  });

  private formatDateForInput(date: Date | null): string {
    if (!date) return "";
    // Format as YYYY-MM-DD for HTML date input
    return date.toISOString().split("T")[0];
  }

  private formatSecondsAsTime(seconds: number | undefined): string {
    if (seconds === undefined || seconds === null) return "00:00";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  }

  override render() {
    return html`
      <nav>
        <a href="/admin">Anmeldeübersicht</a>
        <a href="/admin-acts-overview">Küren Übersicht</a>
      </nav>

      <h1>Kategorie Verwaltung</h1>

      ${this.categories.render({
        pending: () => html`<p>Lade Kategorien...</p>`,
        error: (error) => html`<p>Fehler beim Laden: ${error}</p>`,
        complete: (categories) => this.renderCategoriesTable(categories),
      })}
    `;
  }

  private renderCategoriesTable(
    categories: components["schemas"]["Category"][]
  ) {
    return html`
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Beschreibung</th>
            <th>Von</th>
            <th>Bis</th>
            <th>Paar</th>
            <th>Sonderpokal</th>
            <th>Männlich</th>
            <th>Einfahrt (s)</th>
            <th>Kür (s)</th>
            <th>Bewertung (s)</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${repeat(
            categories,
            (category) => category.name,
            (category) =>
              this.editingCategory === category.name
                ? this.renderEditRow(category)
                : this.renderCategoryRow(category)
          )}
          ${this.showNewForm
            ? this.renderNewCategoryRow()
            : html`<tr>
                <td colspan="11" style="text-align: center; padding: 0;">
                  <button
                    @click=${this.showAddForm}
                    style="width: 100%; padding: 1rem; border: none; background: #28a745; color: white; font-size: 1.2em; cursor: pointer;"
                  >
                    <span class="material-icon" style="vertical-align: middle;"
                      >add</span
                    >
                    Neue Kategorie
                  </button>
                </td>
              </tr>`}
        </tbody>
      </table>
    `;
  }

  private renderCategoryRow(category: components["schemas"]["Category"]) {
    return html`
      <tr>
        <td>${category.name}</td>
        <td>${category.description || ""}</td>
        <td>
          ${this.formatDateForInput(new Date(category.from_birthday || ""))}
        </td>
        <td>
          ${this.formatDateForInput(new Date(category.to_birthday || ""))}
        </td>
        <td>${category.is_pair ? "✓" : ""}</td>
        <td>${category.is_sonderpokal ? "✓" : ""}</td>
        <td>${category.is_single_male ? "✓" : ""}</td>
        <td>${this.formatSecondsAsTime(category.einfahrzeit_seconds || 0)}</td>
        <td>${this.formatSecondsAsTime(category.act_duration_seconds || 0)}</td>
        <td>
          ${this.formatSecondsAsTime(category.judge_duration_seconds || 0)}
        </td>
        <td>
          <div class="actions">
            <button
              class="edit-btn"
              @click=${() => this.startEditCategory(category)}
            >
              <span class="material-icon">edit</span>
            </button>
            <button
              class="delete-btn"
              @click=${() => this.deleteCategory(category.name)}
            >
              <span class="material-icon">delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  private renderEditRow(category: components["schemas"]["Category"]) {
    return html`
      <tr>
        <td>
          <input
            type="text"
            .value=${this.editForm.new_name || category.name}
            @input=${(e: Event) =>
              (this.editForm = {
                ...this.editForm,
                new_name: (e.target as HTMLInputElement).value,
              })}
          />
        </td>
        <td>
          <textarea
            .value=${this.editForm.description ?? category.description ?? ""}
            @input=${(e: Event) =>
              (this.editForm = {
                ...this.editForm,
                description: (e.target as HTMLTextAreaElement).value,
              })}
          ></textarea>
        </td>
        <td>
          <input
            type="date"
            .value=${this.editForm.from_birthday ||
            category.from_birthday ||
            "1970-01-01"}
            @input=${(e: Event) =>
              (this.editForm = {
                ...this.editForm,
                from_birthday: (e.target as HTMLInputElement).value,
              })}
          />
        </td>
        <td>
          <input
            type="date"
            .value=${this.editForm.to_birthday ||
            category.to_birthday ||
            new Date().toISOString().split("T")[0]}
            @input=${(e: Event) =>
              (this.editForm = {
                ...this.editForm,
                to_birthday: (e.target as HTMLInputElement).value,
              })}
          />
        </td>
        <td>
          <input
            type="checkbox"
            ?checked=${this.editForm.is_pair ?? category.is_pair}
            @change=${(e: Event) =>
              (this.editForm = {
                ...this.editForm,
                is_pair: (e.target as HTMLInputElement).checked,
              })}
          />
        </td>
        <td>
          <input
            type="checkbox"
            ?checked=${this.editForm.is_sonderpokal ?? category.is_sonderpokal}
            @change=${(e: Event) =>
              (this.editForm = {
                ...this.editForm,
                is_sonderpokal: (e.target as HTMLInputElement).checked,
              })}
          />
        </td>
        <td>
          <input
            type="checkbox"
            ?checked=${this.editForm.is_single_male ?? category.is_single_male}
            @change=${(e: Event) =>
              (this.editForm = {
                ...this.editForm,
                is_single_male: (e.target as HTMLInputElement).checked,
              })}
          />
        </td>
        <td>
          <input
            type="number"
            style="width: 4em;"
            .value=${(
              this.editForm.einfahrzeit_seconds ??
              category.einfahrzeit_seconds ??
              600
            )?.toString()}
            @input=${(e: Event) =>
              (this.editForm = {
                ...this.editForm,
                einfahrzeit_seconds: parseInt(
                  (e.target as HTMLInputElement).value
                ),
              })}
          />
        </td>
        <td>
          <input
            type="number"
            style="width: 4em;"
            .value=${(
              this.editForm.act_duration_seconds ??
              category.act_duration_seconds ??
              180
            )?.toString()}
            @input=${(e: Event) =>
              (this.editForm = {
                ...this.editForm,
                act_duration_seconds: parseInt(
                  (e.target as HTMLInputElement).value
                ),
              })}
          />
        </td>
        <td>
          <input
            type="number"
            style="width: 4em;"
            .value=${(
              this.editForm.judge_duration_seconds ??
              category.judge_duration_seconds ??
              (this.editForm.judge_duration_seconds ??
                category.judge_duration_seconds ??
                120) / 2
            )?.toString()}
            @input=${(e: Event) =>
              (this.editForm = {
                ...this.editForm,
                judge_duration_seconds: parseInt(
                  (e.target as HTMLInputElement).value
                ),
              })}
          />
        </td>
        <td>
          <div class="actions">
            <button class="save-btn" @click=${this.saveEditCategory}>
              <span class="material-icon">save</span>
            </button>
            <button class="cancel-btn" @click=${this.cancelEditCategory}>
              <span class="material-icon">cancel</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  private showAddForm() {
    this.showNewForm = true;
    this.newCategory = {
      is_pair: false,
      is_sonderpokal: false,
      is_single_male: false,
      einfahrzeit_seconds: 600, // 10 minutes default
      act_duration_seconds: 120, // 2 minutes default
      judge_duration_seconds: 240, // 4 minutes default
    };
  }

  private async saveNewCategory() {
    if (
      !this.newCategory.name ||
      !this.newCategory.from_birthday ||
      !this.newCategory.to_birthday
    ) {
      alert("Bitte füllen Sie alle Pflichtfelder aus.");
      return;
    }

    try {
      await client.POST("/api/command/add_category", {
        body: {
          name: this.newCategory.name!,
          description: this.newCategory.description || null,
          from_birthday: this.newCategory.from_birthday + "T00:00:00Z",
          to_birthday: this.newCategory.to_birthday + "T00:00:00Z",
          is_pair: this.newCategory.is_pair || false,
          is_sonderpokal: this.newCategory.is_sonderpokal || false,
          is_single_male: this.newCategory.is_single_male || false,
          einfahrzeit_seconds: this.newCategory.einfahrzeit_seconds || 600,
          act_duration_seconds: this.newCategory.act_duration_seconds || 120,
          judge_duration_seconds:
            this.newCategory.judge_duration_seconds || 240,
        },
      });
      this.categories.run();
      this.cancelNewCategory();
    } catch (error) {
      alert("Fehler beim Erstellen der Kategorie: " + error);
    }
  }

  private cancelNewCategory() {
    this.showNewForm = false;
    this.newCategory = {};
  }

  private renderNewCategoryRow() {
    return html`
      <tr>
        <td>
          <input
            type="text"
            placeholder="Name"
            .value=${this.newCategory.name || ""}
            @input=${(e: Event) =>
              (this.newCategory = {
                ...this.newCategory,
                name: (e.target as HTMLInputElement).value,
              })}
          />
        </td>
        <td>
          <textarea
            placeholder="Beschreibung"
            .value=${this.newCategory.description || ""}
            @input=${(e: Event) =>
              (this.newCategory = {
                ...this.newCategory,
                description: (e.target as HTMLTextAreaElement).value,
              })}
          ></textarea>
        </td>
        <td>
          <input
            type="date"
            .value=${this.newCategory.from_birthday || ""}
            @input=${(e: Event) =>
              (this.newCategory = {
                ...this.newCategory,
                from_birthday: (e.target as HTMLInputElement).value,
              })}
          />
        </td>
        <td>
          <input
            type="date"
            .value=${this.newCategory.to_birthday || ""}
            @input=${(e: Event) =>
              (this.newCategory = {
                ...this.newCategory,
                to_birthday: (e.target as HTMLInputElement).value,
              })}
          />
        </td>
        <td>
          <input
            type="checkbox"
            ?checked=${this.newCategory.is_pair}
            @change=${(e: Event) =>
              (this.newCategory = {
                ...this.newCategory,
                is_pair: (e.target as HTMLInputElement).checked,
              })}
          />
        </td>
        <td>
          <input
            type="checkbox"
            ?checked=${this.newCategory.is_sonderpokal}
            @change=${(e: Event) =>
              (this.newCategory = {
                ...this.newCategory,
                is_sonderpokal: (e.target as HTMLInputElement).checked,
              })}
          />
        </td>
        <td>
          <input
            type="checkbox"
            ?checked=${this.newCategory.is_single_male}
            @change=${(e: Event) =>
              (this.newCategory = {
                ...this.newCategory,
                is_single_male: (e.target as HTMLInputElement).checked,
              })}
          />
        </td>
        <td>
          <input
            type="number"
            style="width: 4em;"
            .value=${this.newCategory.einfahrzeit_seconds?.toString() || "600"}
            @input=${(e: Event) =>
              (this.newCategory = {
                ...this.newCategory,
                einfahrzeit_seconds: parseInt(
                  (e.target as HTMLInputElement).value
                ),
              })}
          />
        </td>
        <td>
          <input
            type="number"
            .value=${this.newCategory.act_duration_seconds?.toString() || "120"}
            @input=${(e: Event) =>
              (this.newCategory = {
                ...this.newCategory,
                act_duration_seconds: parseInt(
                  (e.target as HTMLInputElement).value
                ),
              })}
          />
        </td>
        <td>
          <input
            type="number"
            style="width: 4em;"
            .value=${this.newCategory.judge_duration_seconds?.toString() ||
            "240"}
            @input=${(e: Event) =>
              (this.newCategory = {
                ...this.newCategory,
                judge_duration_seconds: parseInt(
                  (e.target as HTMLInputElement).value
                ),
              })}
          />
        </td>
        <td>
          <div class="actions">
            <button class="save-btn" @click=${this.saveNewCategory}>
              <span class="material-icon">save</span>
            </button>
            <button class="cancel-btn" @click=${this.cancelNewCategory}>
              <span class="material-icon">cancel</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  private startEditCategory(category: components["schemas"]["Category"]) {
    this.editingCategory = category.name;
    this.editForm = {
      name: category.name,
      new_name: category.name,
      description: category.description,
      from_birthday: this.formatDateForInput(
        new Date(category.from_birthday || "")
      ),
      to_birthday: this.formatDateForInput(
        new Date(category.to_birthday || "")
      ),
      is_pair: category.is_pair,
      is_sonderpokal: category.is_sonderpokal,
      is_single_male: category.is_single_male,
      einfahrzeit_seconds: category.einfahrzeit_seconds,
      act_duration_seconds: category.act_duration_seconds,
      judge_duration_seconds: category.judge_duration_seconds,
    };
  }

  private async saveEditCategory() {
    if (
      !this.editForm.new_name ||
      !this.editForm.from_birthday ||
      !this.editForm.to_birthday
    ) {
      alert("Bitte füllen Sie alle Pflichtfelder aus.");
      return;
    }

    try {
      await client.POST("/api/command/edit_category", {
        body: {
          name: this.editForm.name!,
          new_name: this.editForm.new_name!,
          description: this.editForm.description || null,
          from_birthday: this.editForm.from_birthday + "T00:00:00Z",
          to_birthday: this.editForm.to_birthday + "T00:00:00Z",
          is_pair: this.editForm.is_pair!,
          is_sonderpokal: this.editForm.is_sonderpokal!,
          is_single_male: this.editForm.is_single_male!,
          einfahrzeit_seconds: this.editForm.einfahrzeit_seconds!,
          act_duration_seconds: this.editForm.act_duration_seconds!,
          judge_duration_seconds: this.editForm.judge_duration_seconds!,
        },
      });
      this.categories.run();
      this.cancelEditCategory();
    } catch (error) {
      alert("Fehler beim Bearbeiten der Kategorie: " + error);
    }
  }

  private cancelEditCategory() {
    this.editingCategory = null;
    this.editForm = {};
  }

  private async deleteCategory(categoryName: string) {
    if (
      !confirm(
        `Sind Sie sicher, dass Sie die Kategorie "${categoryName}" löschen möchten?`
      )
    ) {
      return;
    }

    try {
      await client.POST("/api/command/delete_category", {
        body: { name: categoryName },
      });
      this.categories.run();
    } catch (error) {
      alert("Fehler beim Löschen der Kategorie: " + error);
    }
  }
}
