import { consume } from "@lit/context";
import { Task, TaskStatus } from "@lit/task";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { errorMessage, unwrap } from "../../api";
import { client, type components } from "../../apiClient";
import { type Club, clubContext } from "../../contexts/club";
import {
  type SystemStatus,
  systemStatusContext,
} from "../../contexts/systemStatus";
import { type User, userContext } from "../../contexts/user";
import { iconStyles, resetStyles } from "../../styles/base";
import { clubManagerStyles } from "../../styles/club-manager";
import {
  type ActType,
  actTypeLabels,
  actTypeShort,
  formatMoney,
  getStarterPrice,
} from "../../utils";

type Starter = { birthdate: Date } & Omit<
  components["schemas"]["ClubStarter"],
  "birthdate"
>;

type MaybeNewStarter = Omit<Omit<Starter, "id">, "club_id">;

/** A starter's membership in a group. */
interface GroupMembership {
  id: string;
  group_name: string;
  act_type: ActType;
  is_replacement: boolean;
}

const emptyStarter = (): MaybeNewStarter => ({
  firstname: "",
  lastname: "",
  birthdate: new Date(),
  single_male: false,
  single_female: false,
  pair: false,
  partner_name: "",
  group_count: 0,
  waived_count: 0,
});

/** The value of a date input; "" for an invalid date (a cleared input). */
const dateInputValue = (date: Date) =>
  Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses the paid amount like the payments view (cup-view-admin-payments)
 * does, so both screens store the same amount for the same text: at most two
 * decimals, "," or "." as decimal separator ("120", "120,5", "120.50",
 * "1.505,00 €"); `null` if invalid. A separator followed by three digits is
 * only accepted as German thousands separator ("1.505", not "1,505").
 */
const parseAmount = (text: string) => {
  const t = text.replace(/[\s\u00a0€]/g, "");
  const german = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(t);
  const plain = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(t);
  const match = german ?? plain;
  if (!match) {
    return null;
  }
  const value = Number(`${match[1].replaceAll(".", "")}.${match[2] ?? "0"}`);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
};

@customElement("cup-club-starter-manager")
export default class CupClubStarterManager extends LitElement {
  static override styles = [
    resetStyles,
    iconStyles,
    clubManagerStyles,
    css`
      ul.groups {
        list-style: none;
      }

      .payment input {
        width: 6em;
        text-align: right;
      }
    `,
  ];

  @consume({ context: clubContext, subscribe: true }) club: Club | null = null;

  @consume({ context: systemStatusContext, subscribe: true })
  systemStatus: SystemStatus | null = null;
  @consume({ context: userContext, subscribe: true }) user: User | null = null;

  @property({ type: Boolean, attribute: "admin-mode" }) adminMode = false;

  /** Bumped by cup-club-manager to reload after changes in other managers. */
  @property({ attribute: false }) refresh = 0;

  starters = new Task(this, {
    task: async ([clubId]) => {
      if (!clubId) {
        return [];
      }
      const starters = unwrap(
        await client.GET("/api/query/list_club_starters", {
          params: { query: { club_id: clubId } },
        }),
      );
      return starters.map((starter) => {
        const birthdate = new Date(starter.birthdate);
        return { ...starter, birthdate };
      });
    },
    args: () => [this.club?.id, this.refresh],
  });

  /** The groups of each starter: starter id → memberships. */
  groups = new Task(this, {
    task: async ([clubId]) => {
      const memberships = new Map<string, GroupMembership[]>();
      if (!clubId) {
        return memberships;
      }
      const groups = unwrap(
        await client.GET("/api/query/list_club_groups", {
          params: { query: { club_id: clubId } },
        }),
      );
      for (const group of groups) {
        for (const member of group.members) {
          memberships.set(member.starter_id, [
            ...(memberships.get(member.starter_id) ?? []),
            {
              id: group.id,
              group_name: group.group_name,
              act_type: group.act_type,
              is_replacement: member.is_replacement,
            },
          ]);
        }
      }
      return memberships;
    },
    args: () => [this.club?.id, this.refresh],
  });

  @state() starterEdits = new Map<string, Starter>();
  @state() addStarter: MaybeNewStarter = emptyStarter();

  @state() addStarterMode = false;
  @state() error: string | null = null;
  /** The amount an admin is entering as paid; `null` while not editing. */
  @state() paymentInput: string | null = null;

  @query("#error") errorBanner?: HTMLElement;

  get canEdit() {
    return !!(this.systemStatus?.can_register_starter || this.user?.is_admin);
  }

  get columnCount() {
    return this.adminMode ? 12 : 10;
  }

  override render() {
    const starters = this.starters.value ?? [];
    return html`<h4>Starter</h4>
      <h5>Zusammenfassung</h5>

      <datalist id="clubStarters">
        ${repeat(
          starters,
          (starter) => starter.id,
          (starter) =>
            html`<option
              value="${starter.firstname} ${starter.lastname}"
            ></option>`,
        )}
      </datalist>

      <table id="summary">
        <tr>
          <th>Starter</th>
          <td>${this.starters.value?.length}</td>
        </tr>
        <tr>
          <th>Gesamtstartgebühr</th>
          <td>
            ${formatMoney(
              starters.reduce(
                (acc, starter) =>
                  acc +
                  getStarterPrice(starter, this.systemStatus?.competition),
                0,
              ),
            )}
          </td>
        </tr>
        <tr>
          <th>Bezahlt</th>
          <td class="payment">${this.renderPayment()}</td>
        </tr>
      </table>

      <h5>Starter</h5>
      ${
        this.error
          ? html`<p id="error" class="error-banner" role="alert">
            ${this.error}
            <button
              class="material-icon"
              title="Schließen"
              aria-label="Schließen"
              @click=${this.clearError}
            >
              close
            </button>
          </p>`
          : nothing
      }
      <table class="items">
        <thead>
          <tr>
            ${this.adminMode ? html`<th>ID</th>` : nothing}
            <th>Vorname</th>
            <th>Nachname</th>
            <th>Geburtstag</th>
            <th>Einzel M</th>
            <th>Einzel W</th>
            <th>Paar</th>
            <th>Partner</th>
            ${this.adminMode ? html`<th>Partner ID</th>` : nothing}
            <th>Gruppen</th>
            <th>Startgeld</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${
            this.canEdit
              ? this.addStarterMode
                ? this.renderAddRow()
                : html`<tr class="addRow fullRow">
                  <td colspan=${this.columnCount}>
                    <button
                      class="addButton material-icon"
                      title="Starter hinzufügen"
                      aria-label="Starter hinzufügen"
                      @click=${this.enterAddStarterMode}
                    >
                      add
                    </button>
                  </td>
                </tr>`
              : nothing
          }
          ${
            this.starters.status === TaskStatus.ERROR
              ? html`<tr class="fullRow">
                <td colspan=${this.columnCount}>
                  ${errorMessage(this.starters.error)}
                </td>
              </tr>`
              : this.starters.value === undefined
                ? html`<tr class="fullRow">
                  <td colspan=${this.columnCount}>Lädt Starter...</td>
                </tr>`
                : nothing
          }
          ${repeat(
            starters,
            (starter) => starter.id,
            (starter) => {
              const editStarter = this.starterEdits.get(starter.id);
              return editStarter
                ? this.renderEditRow(editStarter)
                : this.renderStarterRow(starter);
            },
          )}
        </tbody>
      </table>
      ${
        this.adminMode
          ? nothing
          : html`<p>
            <em
              >Paarkürpartner innerhalb eines Vereins werden automatisch
              verbunden. Vereinsübergreifende Paare werden vom Veranstalter
              verifiziert. Bis dies geschehen ist, wird der Partner mit einem ⌛
              markiert.</em
            >
          </p>`
      }`;
  }

  renderPayment() {
    if (this.paymentInput === null) {
      return html`${formatMoney(this.club?.payment)}${
        this.adminMode
          ? html` <button class="blue" @click=${this.editPayment}>
              Betrag aktualisieren
            </button>`
          : nothing
      }`;
    }
    return html`<input
        type="text"
        inputmode="decimal"
        aria-label="Bezahlter Betrag in Euro"
        .value=${this.paymentInput}
        @input=${this.updatePaymentInput}
        @keydown=${this.paymentKeydown}
      />
      €
      <button
        class="green material-icon"
        title="Speichern"
        aria-label="Speichern"
        @click=${this.savePayment}
      >
        save
      </button>
      <button
        class="red material-icon"
        title="Abbrechen"
        aria-label="Abbrechen"
        @click=${this.cancelPayment}
      >
        cancel
      </button>`;
  }

  renderAddRow() {
    return html`<tr class="addRow">
      ${this.adminMode ? html`<td></td>` : nothing}
      <td>
        <label
          ><span>Vorname</span
          ><input
            type="text"
            .value=${this.addStarter.firstname}
            @input=${this.updateAddStarterFirstname}
            placeholder="Vorname"
        /></label>
      </td>
      <td>
        <label
          ><span>Nachname</span
          ><input
            type="text"
            .value=${this.addStarter.lastname}
            @input=${this.updateAddStarterLastname}
            placeholder="Nachname"
        /></label>
      </td>
      <td>
        <label
          ><span>Geburtstag</span
          ><input
            type="date"
            .value=${dateInputValue(this.addStarter.birthdate)}
            @input=${this.updateAddStarterBirthdate}
        /></label>
      </td>
      <td>
        <label
          ><span>Einzel Männlich</span
          ><input
            type="checkbox"
            .checked=${this.addStarter.single_male}
            @input=${this.updateAddStarterSingleMale}
        /></label>
      </td>
      <td>
        <label
          ><span>Einzel Weiblich</span
          ><input
            type="checkbox"
            .checked=${this.addStarter.single_female}
            @input=${this.updateAddStarterSingleFemale}
        /></label>
      </td>
      <td>
        <label
          ><span>Paar</span
          ><input
            type="checkbox"
            .checked=${this.addStarter.pair}
            @input=${this.updateAddStarterPair}
        /></label>
      </td>
      <td>
        <label
          ><span>Partner Name</span>
          <input
            type="text"
            .value=${this.addStarter.partner_name || ""}
            @input=${this.updateAddStarterPartnerName}
            placeholder="Partner Name"
            list="clubStarters"
            ?disabled=${!this.addStarter.pair}
        /></label>
      </td>
      ${
        this.adminMode
          ? html`<td>
            <label
              ><span>Partner ID</span>
              <input
                type="text"
                .value=${this.addStarter.partner_id || ""}
                @input=${this.updateAddStarterPartnerId}
                placeholder="Partner ID"
                ?disabled=${!this.addStarter.pair}
            /></label>
          </td>`
          : nothing
      }
      <td><label><span>Gruppen</span></label> -</td>
      <td>
        <label><span>Startgebühr</span></label>
        ${formatMoney(
          getStarterPrice(this.addStarter, this.systemStatus?.competition),
        )}
      </td>
      <td class="actionCol">
        <button
          class="green material-icon"
          title="Speichern"
          aria-label="Speichern"
          @click=${this.commitAddStarter}
        >
          save
        </button>
        <button
          class="red material-icon"
          title="Abbrechen"
          aria-label="Abbrechen"
          @click=${this.resetAddStarter}
        >
          cancel
        </button>
      </td>
    </tr>`;
  }

  renderEditRow(editStarter: Starter) {
    return html`<tr>
      ${this.adminMode ? html`<td>${editStarter.id}</td>` : nothing}
      <td>
        <label
          ><span>Vorname</span
          ><input
            type="text"
            .value=${editStarter.firstname}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: InputEvent) => this.updateEditStarterFirstname(editStarter, e)
            }
            placeholder="Vorname"
        /></label>
      </td>
      <td>
        <label
          ><span>Nachname</span
          ><input
            type="text"
            .value=${editStarter.lastname}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: InputEvent) => this.updateEditStarterLastname(editStarter, e)
            }
            placeholder="Nachname"
        /></label>
      </td>
      <td>
        <label
          ><span>Geburtstag</span
          ><input
            type="date"
            .value=${dateInputValue(editStarter.birthdate)}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: InputEvent) => this.updateEditStarterBirthdate(editStarter, e)
            }
        /></label>
      </td>
      <td>
        <label
          ><span>Einzel Männlich</span
          ><input
            type="checkbox"
            .checked=${editStarter.single_male}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: InputEvent) =>
                this.updateEditStarterSingleMale(editStarter, e)
            }
        /></label>
      </td>
      <td>
        <label
          ><span>Einzel Weiblich</span
          ><input
            type="checkbox"
            .checked=${editStarter.single_female}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: InputEvent) =>
                this.updateEditStarterSingleFemale(editStarter, e)
            }
        /></label>
      </td>
      <td>
        <label
          ><span>Paar</span
          ><input
            type="checkbox"
            .checked=${editStarter.pair}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: InputEvent) => this.updateEditStarterPair(editStarter, e)
            }
        /></label>
      </td>
      <td>
        <label
          ><span>Partner Name</span
          ><input
            type="text"
            .value=${editStarter.partner_name || ""}
            @input=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: InputEvent) =>
                this.updateEditStarterPartnerName(editStarter, e)
            }
            placeholder="Partner Name"
            list="clubStarters"
            ?disabled=${!editStarter.pair}
        /></label>
      </td>
      ${
        this.adminMode
          ? html`<td>
            <label
              ><span>Partner ID</span
              ><input
                type="text"
                .value=${editStarter.partner_id || ""}
                @input=${
                  // eslint-disable-next-line lit/no-template-arrow
                  (e: InputEvent) =>
                    this.updateEditStarterPartnerId(editStarter, e)
                }
                placeholder="Partner ID"
                ?disabled=${!editStarter.pair}
            /></label>
          </td>`
          : nothing
      }
      <td>
        <label><span>Gruppen</span></label>
        ${this.renderGroups(editStarter)}
      </td>
      <td>
        <label><span>Startgebühr</span></label>
        ${formatMoney(
          getStarterPrice(editStarter, this.systemStatus?.competition),
        )}
      </td>
      <td class="actionCol">
        <button
          class="green material-icon"
          title="Speichern"
          aria-label="Speichern"
          @click=${
            // eslint-disable-next-line lit/no-template-arrow
            () => this.commitStarterEdit(editStarter)
          }
        >
          save
        </button>
        <button
          class="red material-icon"
          title="Abbrechen"
          aria-label="Abbrechen"
          @click=${
            // eslint-disable-next-line lit/no-template-arrow
            () => this.disableStarterEdit(editStarter)
          }
        >
          cancel
        </button>
      </td>
    </tr>`;
  }

  renderStarterRow(starter: Starter) {
    return html`<tr>
      ${this.adminMode ? html`<td>${starter.id}</td>` : nothing}
      <td><label><span>Vorname</span></label> ${starter.firstname}</td>
      <td><label><span>Nachname</span></label> ${starter.lastname}</td>
      <td>
        <label><span>Geburtstag</span></label>
        ${starter.birthdate.toLocaleDateString("de-DE")}
      </td>
      <td>
        <label><span>Einzel Männlich</span></label>
        ${starter.single_male ? "✔️" : "-"}
      </td>
      <td>
        <label><span>Einzel Weiblich</span></label>
        ${starter.single_female ? "✔️" : "-"}
      </td>
      <td>
        <label><span>Paar</span></label> ${starter.pair ? "✔️" : "-"}
      </td>
      <td>
        <label><span>Partner</span></label> ${
          starter.pair && starter.partner_name
            ? starter.resolved_partner_name
              ? `✔️ ${starter.resolved_partner_name} (${starter.resolved_partner_club})`
              : `⌛ ${starter.partner_name}`
            : nothing
        }
      </td>
      ${
        this.adminMode
          ? html`<td>
            <label><span>Partner ID</span></label>
            ${starter.pair && starter.partner_id ? starter.partner_id : nothing}
          </td>`
          : nothing
      }
      <td>
        <label><span>Gruppen</span></label>
        ${this.renderGroups(starter)}
      </td>
      <td>
        <label><span>Startgebühr</span></label>
        ${formatMoney(getStarterPrice(starter, this.systemStatus?.competition))}
      </td>
      <td class="actionCol">
        ${
          this.canEdit
            ? html`<button
                @click=${
                  // eslint-disable-next-line lit/no-template-arrow
                  () => this.enableStarterEdit(starter)
                }
                class="blue material-icon"
                title="Bearbeiten"
                aria-label="Bearbeiten"
              >
                edit
              </button>
              <button
                @click=${
                  // eslint-disable-next-line lit/no-template-arrow
                  () => this.deleteStarter(starter)
                }
                class="red material-icon"
                title="Löschen"
                aria-label="Löschen"
              >
                delete
              </button>`
            : nothing
        }
      </td>
    </tr>`;
  }

  /** The starter's groups ("KG Wirbelwind"); groups are edited below. */
  renderGroups(starter: Starter) {
    const memberships = this.groups.value?.get(starter.id);
    if (!memberships?.length) {
      // Without the group list (still loading or failed) only the count.
      return starter.group_count ? String(starter.group_count) : "-";
    }
    return html`<ul class="groups">
      ${repeat(
        memberships,
        (membership) => membership.id,
        (membership) =>
          html`<li
            title="${actTypeLabels[membership.act_type]} „${membership.group_name}“${
              membership.is_replacement ? " (Ersatz)" : ""
            }"
          >
            <span class="badge">${actTypeShort[membership.act_type]}</span>
            ${membership.group_name}${
              membership.is_replacement
                ? html` <span class="badge muted">Ersatz</span>`
                : nothing
            }
          </li>`,
      )}
    </ul>`;
  }

  enableStarterEdit(starter: Starter) {
    this.starterEdits.set(starter.id, { ...starter });
    this.requestUpdate();
  }

  disableStarterEdit(starter: Starter) {
    this.starterEdits.delete(starter.id);
    this.requestUpdate();
  }

  async commitStarterEdit(starter: Starter) {
    const invalid = validateStarter(starter);
    if (invalid) {
      return this.showError(invalid);
    }

    try {
      unwrap(
        await client.POST("/api/command/edit_club_starter", {
          body: {
            ...starter,
            starter_id: starter.id,
            birthdate: starter.birthdate.toISOString(),
            partner_name: starter.partner_name ? starter.partner_name : null,
            // A cleared "Partner ID" field is "", which isn't a UUID.
            partner_id: (starter.pair && starter.partner_id?.trim()) || null,
          },
        }),
      );
    } catch (error) {
      return this.showError(`Fehler beim Speichern: ${errorMessage(error)}`);
    }
    this.starterEdits.delete(starter.id);
    this.clearError();
    this.dataChanged();
  }

  async deleteStarter(starter: Starter) {
    const name = `${starter.firstname} ${starter.lastname}`;
    const groups = starter.group_count
      ? `\n${name} wird dabei auch aus ${
          starter.group_count === 1
            ? "einer Gruppe"
            : `${starter.group_count} Gruppen`
        } entfernt.`
      : "";
    if (!confirm(`Sicher, dass du ${name} löschen willst?${groups}`)) {
      return;
    }
    let warnings: string[];
    try {
      ({ warnings } = unwrap(
        await client.POST("/api/command/delete_club_starter", {
          body: { starter_id: starter.id },
        }),
      ));
    } catch (error) {
      return this.showError(`Fehler beim Löschen: ${errorMessage(error)}`);
    }
    this.starterEdits.delete(starter.id);
    // Deleted, but a group the starter left may now clash with another one.
    if (warnings.length) {
      this.showError(warnings.join("\n"));
    } else {
      this.clearError();
    }
    this.dataChanged();
  }

  updateEditStarterFirstname(starter: Starter, e: InputEvent) {
    starter.firstname = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateEditStarterLastname(starter: Starter, e: InputEvent) {
    starter.lastname = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateEditStarterBirthdate(starter: Starter, e: InputEvent) {
    starter.birthdate = new Date((e.target as HTMLInputElement).value);
    this.requestUpdate();
  }

  // A starter can only start in one single act, so M and W exclude each other.
  updateEditStarterSingleMale(starter: Starter, e: InputEvent) {
    starter.single_male = (e.target as HTMLInputElement).checked;
    if (starter.single_male) {
      starter.single_female = false;
    }
    this.requestUpdate();
  }

  updateEditStarterSingleFemale(starter: Starter, e: InputEvent) {
    starter.single_female = (e.target as HTMLInputElement).checked;
    if (starter.single_female) {
      starter.single_male = false;
    }
    this.requestUpdate();
  }

  updateEditStarterPair(starter: Starter, e: InputEvent) {
    starter.pair = (e.target as HTMLInputElement).checked;
    this.requestUpdate();
  }

  updateEditStarterPartnerName(starter: Starter, e: InputEvent) {
    starter.partner_name = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateEditStarterPartnerId(starter: Starter, e: InputEvent) {
    starter.partner_id = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateAddStarterFirstname(e: InputEvent) {
    this.addStarter.firstname = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateAddStarterLastname(e: InputEvent) {
    this.addStarter.lastname = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateAddStarterBirthdate(e: InputEvent) {
    this.addStarter.birthdate = new Date((e.target as HTMLInputElement).value);
    this.requestUpdate();
  }

  updateAddStarterSingleMale(e: InputEvent) {
    this.addStarter.single_male = (e.target as HTMLInputElement).checked;
    if (this.addStarter.single_male) {
      this.addStarter.single_female = false;
    }
    this.requestUpdate();
  }

  updateAddStarterSingleFemale(e: InputEvent) {
    this.addStarter.single_female = (e.target as HTMLInputElement).checked;
    if (this.addStarter.single_female) {
      this.addStarter.single_male = false;
    }
    this.requestUpdate();
  }

  updateAddStarterPair(e: InputEvent) {
    this.addStarter.pair = (e.target as HTMLInputElement).checked;
    this.requestUpdate();
  }

  updateAddStarterPartnerName(e: InputEvent) {
    this.addStarter.partner_name = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateAddStarterPartnerId(e: InputEvent) {
    this.addStarter.partner_id = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  async commitAddStarter() {
    if (!this.club) {
      return;
    }
    const invalid = validateStarter(this.addStarter);
    if (invalid) {
      return this.showError(invalid);
    }

    try {
      unwrap(
        await client.POST("/api/command/add_club_starter", {
          body: {
            ...this.addStarter,
            club_id: this.club.id,
            birthdate: this.addStarter.birthdate.toISOString(),
            partner_name: this.addStarter.partner_name
              ? this.addStarter.partner_name
              : null,
            partner_id:
              (this.addStarter.pair && this.addStarter.partner_id?.trim()) ||
              null,
          },
        }),
      );
    } catch (error) {
      return this.showError(`Fehler beim Speichern: ${errorMessage(error)}`);
    }
    this.resetAddStarter();
    this.clearError();
    this.dataChanged();
  }

  resetAddStarter() {
    this.addStarter = emptyStarter();
    this.addStarterMode = false;
  }

  enterAddStarterMode() {
    this.addStarterMode = true;
  }

  editPayment() {
    this.paymentInput = (this.club?.payment ?? 0).toFixed(2).replace(".", ",");
  }

  cancelPayment() {
    this.paymentInput = null;
  }

  updatePaymentInput(e: InputEvent) {
    this.paymentInput = (e.target as HTMLInputElement).value;
  }

  paymentKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      this.savePayment();
    } else if (e.key === "Escape") {
      this.cancelPayment();
    }
  }

  async savePayment() {
    if (!this.club || this.paymentInput === null) {
      return;
    }
    const amount = parseAmount(this.paymentInput);
    if (amount === null) {
      return this.showError(
        "Ungültiger Betrag. Bitte den bezahlten Betrag in Euro angeben, z. B. 45,00 oder 1.350,00.",
      );
    }
    try {
      unwrap(
        await client.POST("/api/command/set_payment", {
          body: { club_id: this.club.id, amount },
        }),
      );
    } catch (error) {
      return this.showError(`Fehler beim Speichern: ${errorMessage(error)}`);
    }
    // The club comes from cup-context-club, which doesn't reload it.
    this.club.payment = amount;
    this.paymentInput = null;
    this.clearError();
    this.dataChanged();
  }

  clearError() {
    this.error = null;
  }

  async showError(message: string) {
    this.error = message;
    await this.updateComplete;
    this.errorBanner?.scrollIntoView({ block: "nearest" });
  }

  /**
   * Reloads after a successful change. Inside cup-club-manager, the club
   * manager cancels the event and reloads all managers (starters change
   * fees and groups); standalone, only this manager reloads.
   */
  dataChanged() {
    const event = new Event("club-data-changed", {
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    if (this.dispatchEvent(event)) {
      this.starters.run();
      this.groups.run();
    }
  }
}

/** A German message if the starter can't be saved like this. */
const validateStarter = (starter: MaybeNewStarter) => {
  if (!starter.firstname.trim() || !starter.lastname.trim()) {
    return "Vorname und Nachname müssen angegeben werden.";
  }

  if (Number.isNaN(starter.birthdate.getTime())) {
    return "Bitte gib ein gültiges Geburtsdatum an.";
  }

  if (starter.single_male && starter.single_female) {
    return "Ein Starter kann nur in einer Einzelkür starten (Einzel M oder Einzel W).";
  }

  // Only admins see the field; without "Paar" it is ignored.
  const partnerId = starter.pair && starter.partner_id?.trim();
  if (partnerId && !UUID_PATTERN.test(partnerId)) {
    return "Die Partner ID ist ungültig.";
  }

  return null;
};
