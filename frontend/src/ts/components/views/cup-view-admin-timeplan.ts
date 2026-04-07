import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { Task } from "@lit/task";
import { repeat } from "lit/directives/repeat.js";

@customElement("cup-view-admin-timeplan")
export default class CupViewAdminTimeplan extends LitElement {
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
    .form-row textarea,
    .form-row select {
      flex: 1;
      padding: 0.25rem;
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

    .move-btn {
      background-color: #17a2b8;
      color: white;
      border: none;
      padding: 0.25rem 0.5rem;
    }

    .move-btn:disabled {
      background-color: #ccc;
    }
  `;

  @state()
  private editingEntryId: number | null = null;

  @state()
  private newEntry: Partial<components["schemas"]["TimeplanListEntry"]> = {};

  @state()
  private editForm: Partial<components["schemas"]["TimeplanListEntry"]> = {};

  @state()
  private showNewForm = false;

  timeplanEntries = new Task(this, {
    args: () => [],
    task: async () => {
      const data = await client.GET("/api/query/list_timeplan");
      if (data.error) {
        throw new Error((data.error as { message: string }).message);
      }
      return data.data || [];
    },
  });

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

  private formatDateTimeForInput(date: Date | string | null): string {
    if (!date) return "";
    const d = typeof date === "string" ? new Date(date) : date;
    // Format as YYYY-MM-DDTHH:mm for HTML datetime-local input
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  private formatDateTimeForDisplay(date: Date | string | null): string {
    if (!date) return "-";
    const d = typeof date === "string" ? new Date(date) : date;
    // Format as readable date and time in user's local timezone
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  private formatSecondsAsTime(seconds: number | undefined | null): string {
    if (seconds === undefined || seconds === null) return "-";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  private getAvailableCategories(
    allCategories: components["schemas"]["Category"][],
    currentCategory: string | null | undefined,
  ): components["schemas"]["Category"][] {
    const entries = this.timeplanEntries.value || [];
    const usedCategories = new Set(
      entries
        .filter((e) => e.category && e.category !== currentCategory)
        .map((e) => e.category),
    );
    return allCategories.filter(
      (cat) => !usedCategories.has(cat.name) || cat.name === currentCategory,
    );
  }

  override render() {
    return html`
      <nav>
        <a href="/admin">Anmeldeübersicht</a>
        <a href="/admin-acts-overview">Küren Übersicht</a>
        <a href="/admin-categories">Kategorie Verwaltung</a>
      </nav>

      <h1>Zeitplan Verwaltung</h1>

      ${this.timeplanEntries.render({
        pending: () => html`<p>Lade Zeitplan...</p>`,
        error: (error) => html`<p>Fehler beim Laden: ${error}</p>`,
        complete: (entries) => this.renderTimeplanTable(entries),
      })}
    `;
  }

  private renderTimeplanTable(
    entries: components["schemas"]["TimeplanListEntry"][],
  ) {
    return html`
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Früheste Startzeit</th>
            <th>Dauer (s)</th>
            <th>Label</th>
            <th>Kategorie</th>
            <th>Gestartet</th>
            <th>Beendet</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          ${repeat(
            entries,
            (entry) => entry.id,
            (entry) =>
              this.editingEntryId === entry.id
                ? this.renderEditRow(entry)
                : this.renderEntryRow(entry),
          )}
          ${this.showNewForm
            ? this.renderNewEntryRow()
            : html`<tr>
                <td colspan="8" style="text-align: center; padding: 0;">
                  <button
                    @click=${this.showAddForm}
                    style="width: 100%; padding: 1rem; border: none; background: #28a745; color: white; font-size: 1.2em; cursor: pointer;"
                  >
                    <span class="material-icon" style="vertical-align: middle;"
                      >add</span
                    >
                    Neuer Eintrag
                  </button>
                </td>
              </tr>`}
        </tbody>
      </table>
    `;
  }

  private renderEntryRow(entry: components["schemas"]["TimeplanListEntry"]) {
    return html`
      <tr>
        <td>${entry.id}</td>
        <td>
          ${this.formatDateTimeForDisplay(entry.earliest_start_time || null)}
        </td>
        <td>${this.formatSecondsAsTime(entry.duration_seconds)}</td>
        <td>${entry.label || "-"}</td>
        <td>${entry.category || "-"}</td>
        <td>
          ${this.formatDateTimeForDisplay(entry.started_at || null)}
        </td>
        <td>
          ${this.formatDateTimeForDisplay(entry.ended_at || null)}
        </td>
        <td>
          <div class="actions">
            <button
              class="move-btn"
              @click=${
                // eslint-disable-next-line lit/no-template-arrow
                () => this.moveEntryUp(entry.id)
              }
              title="Nach oben"
            >
              <span class="material-icon">arrow_upward</span>
            </button>
            <button
              class="move-btn"
              @click=${
                // eslint-disable-next-line lit/no-template-arrow
                () => this.moveEntryDown(entry.id)
              }
              title="Nach unten"
            >
              <span class="material-icon">arrow_downward</span>
            </button>
            <button
              class="edit-btn"
              @click=${
                // eslint-disable-next-line lit/no-template-arrow
                () => this.startEditEntry(entry)
              }
            >
              <span class="material-icon">edit</span>
            </button>
            <button
              class="delete-btn"
              @click=${
                // eslint-disable-next-line lit/no-template-arrow
                () => this.deleteEntry(entry.id)
              }
            >
              <span class="material-icon">delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  private renderEditRow(entry: components["schemas"]["TimeplanListEntry"]) {
    return html`
      <tr>
        <td>${entry.id}</td>
        <td>
          <input
            type="datetime-local"
            .value=${this.formatDateTimeForInput(
              this.editForm.earliest_start_time || entry.earliest_start_time || null,
            )}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: Event) =>
                (this.editForm = {
                  ...this.editForm,
                  earliest_start_time: (e.target as HTMLInputElement).value
                    ? (e.target as HTMLInputElement).value
                    : null,
                })
            }
          />
        </td>
        <td>
          <input
            type="number"
            style="width: 5em;"
            .value=${(
              this.editForm.duration_seconds ??
              entry.duration_seconds ??
              ""
            ).toString()}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: Event) => {
                const val = (e.target as HTMLInputElement).value;
                this.editForm = {
                  ...this.editForm,
                  duration_seconds: val ? parseInt(val) : null,
                };
              }
            }
          />
        </td>
        <td>
          <input
            type="text"
            .value=${this.editForm.label ?? entry.label ?? ""}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: Event) => {
                const val = (e.target as HTMLInputElement).value;
                this.editForm = {
                  ...this.editForm,
                  label: val || null,
                };
              }
            }
          />
        </td>
        <td>
          ${this.categories.render({
            pending: () => html`<span>Laden...</span>`,
            error: () => html`<span>Fehler</span>`,
            complete: (categories) => {
              const selectedCategory = this.editForm.category ?? entry.category ?? "";
              const availableCategories = this.getAvailableCategories(
                categories,
                entry.category,
              );
              return html`
                <select
                  .value=${selectedCategory}
                  @change=${
                    // eslint-disable-next-line lit/no-template-arrow
                    (e: Event) => {
                      const val = (e.target as HTMLSelectElement).value;
                      this.editForm = {
                        ...this.editForm,
                        category: val || null,
                      };
                    }
                  }
                >
                  <option value="" ?selected=${selectedCategory === ""}>-</option>
                  ${availableCategories.map(
                    (cat) =>
                      html`<option value=${cat.name} ?selected=${selectedCategory === cat.name}>${cat.name}</option>`,
                  )}
                </select>
              `;
            },
          })}
        </td>
        <td colspan="2">
          <small>Start/Ende werden durch timeplan_forward/backward gesetzt</small>
        </td>
        <td>
          <div class="actions">
            <button class="save-btn" @click=${this.saveEditEntry}>
              <span class="material-icon">save</span>
            </button>
            <button class="cancel-btn" @click=${this.cancelEditEntry}>
              <span class="material-icon">cancel</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  private showAddForm() {
    this.showNewForm = true;
    this.newEntry = {};
  }

  private async saveNewEntry() {
    try {
      await client.POST("/api/command/add_timeplan_entry", {
        body: {
          earliest_start_time: this.newEntry.earliest_start_time
            ? this.newEntry.earliest_start_time + ":00Z"
            : null,
          duration_seconds: this.newEntry.duration_seconds || null,
          label: this.newEntry.label || null,
          category: this.newEntry.category || null,
        },
      });
      this.timeplanEntries.run();
      this.cancelNewEntry();
    } catch (error) {
      alert("Fehler beim Erstellen des Eintrags: " + error);
    }
  }

  private cancelNewEntry() {
    this.showNewForm = false;
    this.newEntry = {};
  }

  private renderNewEntryRow() {
    return html`
      <tr>
        <td><em>Neu</em></td>
        <td>
          <input
            type="datetime-local"
            .value=${this.formatDateTimeForInput(
              this.newEntry.earliest_start_time || null,
            )}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: Event) => {
                const val = (e.target as HTMLInputElement).value;
                this.newEntry = {
                  ...this.newEntry,
                  earliest_start_time: val || null,
                };
              }
            }
          />
        </td>
        <td>
          <input
            type="number"
            style="width: 5em;"
            placeholder="Sekunden"
            .value=${this.newEntry.duration_seconds?.toString() || ""}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: Event) => {
                const val = (e.target as HTMLInputElement).value;
                this.newEntry = {
                  ...this.newEntry,
                  duration_seconds: val ? parseInt(val) : null,
                };
              }
            }
          />
        </td>
        <td>
          <input
            type="text"
            placeholder="Label"
            .value=${this.newEntry.label || ""}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: Event) => {
                const val = (e.target as HTMLInputElement).value;
                this.newEntry = {
                  ...this.newEntry,
                  label: val || null,
                };
              }
            }
          />
        </td>
        <td>
          ${this.categories.render({
            pending: () => html`<span>Laden...</span>`,
            error: () => html`<span>Fehler</span>`,
            complete: (categories) => {
              const selectedCategory = this.newEntry.category || "";
              const availableCategories = this.getAvailableCategories(
                categories,
                null,
              );
              return html`
                <select
                  .value=${selectedCategory}
                  @change=${
                    // eslint-disable-next-line lit/no-template-arrow
                    (e: Event) => {
                      const val = (e.target as HTMLSelectElement).value;
                      this.newEntry = {
                        ...this.newEntry,
                        category: val || null,
                      };
                    }
                  }
                >
                  <option value="" ?selected=${selectedCategory === ""}>-</option>
                  ${availableCategories.map(
                    (cat) =>
                      html`<option value=${cat.name} ?selected=${selectedCategory === cat.name}>${cat.name}</option>`,
                  )}
                </select>
              `;
            },
          })}
        </td>
        <td colspan="2">-</td>
        <td>
          <div class="actions">
            <button class="save-btn" @click=${this.saveNewEntry}>
              <span class="material-icon">save</span>
            </button>
            <button class="cancel-btn" @click=${this.cancelNewEntry}>
              <span class="material-icon">cancel</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  private startEditEntry(entry: components["schemas"]["TimeplanListEntry"]) {
    this.editingEntryId = entry.id;
    this.editForm = {
      id: entry.id,
      earliest_start_time: entry.earliest_start_time,
      duration_seconds: entry.duration_seconds,
      label: entry.label,
      category: entry.category,
    };
  }

  private async saveEditEntry() {
    try {
      await client.POST("/api/command/edit_timeplan_entry", {
        body: {
          id: this.editForm.id!,
          earliest_start_time: this.editForm.earliest_start_time
            ? this.editForm.earliest_start_time + ":00Z"
            : null,
          duration_seconds: this.editForm.duration_seconds || null,
          label: this.editForm.label || null,
          category: this.editForm.category || null,
        },
      });
      this.timeplanEntries.run();
      this.cancelEditEntry();
    } catch (error) {
      alert("Fehler beim Bearbeiten des Eintrags: " + error);
    }
  }

  private cancelEditEntry() {
    this.editingEntryId = null;
    this.editForm = {};
  }

  private async deleteEntry(entryId: number) {
    if (
      !confirm(
        `Sind Sie sicher, dass Sie diesen Zeitplan-Eintrag löschen möchten?`,
      )
    ) {
      return;
    }

    try {
      await client.POST("/api/command/delete_timeplan_entry", {
        body: { id: entryId },
      });
      this.timeplanEntries.run();
    } catch (error) {
      alert("Fehler beim Löschen des Eintrags: " + error);
    }
  }

  private async moveEntryUp(entryId: number) {
    try {
      await client.POST("/api/command/move_timeplan_up", {
        body: { id: entryId },
      });
      this.timeplanEntries.run();
    } catch (error) {
      // Silently fail if can't move up (already at top)
    }
  }

  private async moveEntryDown(entryId: number) {
    try {
      await client.POST("/api/command/move_timeplan_down", {
        body: { id: entryId },
      });
      this.timeplanEntries.run();
    } catch (error) {
      // Silently fail if can't move down (already at bottom)
    }
  }
}
