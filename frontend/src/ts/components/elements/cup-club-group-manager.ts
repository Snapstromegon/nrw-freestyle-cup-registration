import { consume } from "@lit/context";
import { Task, TaskStatus } from "@lit/task";
import { css, html, LitElement, nothing } from "lit";
import {
  customElement,
  property,
  query,
  queryAll,
  state,
} from "lit/decorators.js";
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
  describeGroup,
  formatMoney,
  type GroupActType,
  groupSizeWarning,
  isGroupActType,
  isUnderAge,
  MAX_SMALL_GROUP_SIZE,
  MIN_GROUP_SIZE,
} from "../../utils";

type ClubGroup = components["schemas"]["ClubGroup"];
type ClubGroupMember = components["schemas"]["ClubGroupMember"];
type GroupSummary = components["schemas"]["GroupSummary"];
type ClubStarter = components["schemas"]["ClubStarter"];
type Category = components["schemas"]["Category"];

/** Groups whose oldest rider is younger than this are U15, otherwise 15+. */
const GROUP_AGE_LIMIT = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The name as the backend stores it: trimmed, inner whitespace collapsed. */
const normalizeGroupName = (name: string) => name.trim().replace(/\s+/g, " ");

/** "7 Fahrer + 1 Ersatz". */
const ridersText = (regular: number, replacements: number) =>
  `${regular} Fahrer${replacements ? ` + ${replacements} Ersatz` : ""}`;

/** A group of `list_groups`: "GG · 10 Fahrer" or "KG · 2 Fahrer, unvollständig". */
const groupSummaryText = (group: GroupSummary) =>
  group.regular_count >= MIN_GROUP_SIZE
    ? describeGroup(
        group.act_type,
        group.regular_count,
        group.replacement_count,
        null,
      )
    : `${actTypeShort[group.act_type]} · ${ridersText(group.regular_count, group.replacement_count)}, unvollständig`;

/** The group types a club chooses from, with their size range. */
const groupTypeChoices: [GroupActType, string][] = [
  [
    "group_small",
    `Kleingruppe (${MIN_GROUP_SIZE}–${MAX_SMALL_GROUP_SIZE} FahrerInnen)`,
  ],
  ["group_large", `Großgruppe (ab ${MAX_SMALL_GROUP_SIZE + 1} FahrerInnen)`],
];

/** The group type chosen in a `<select>` of `groupTypeChoices`. */
const selectedGroupType = (e: Event): GroupActType => {
  const value = (e.target as HTMLSelectElement).value;
  return isGroupActType(value as ActType)
    ? (value as GroupActType)
    : "group_small";
};

const sameGroupName = (a: string, b: string) =>
  a.toLocaleLowerCase("de") === b.toLocaleLowerCase("de");

/** A group whose own riders (and, for its owner, name) are being edited. */
interface GroupEdit {
  /** The group's act id. */
  id: string;
  /** The saved name; `name` is the edited one. */
  originalName: string;
  name: string;
  /** The owner club and admins may rename the group and change its type. */
  canRename: boolean;
  isOwner: boolean;
  /** Own riders when editing started: starter id → replacement rider. */
  original: ReadonlyMap<string, boolean>;
  /** Own riders selected now: starter id → replacement rider. */
  members: Map<string, boolean>;
  /** The saved type; `type` is the edited one. */
  originalType: GroupActType;
  type: GroupActType;
  /** Riders of other clubs; they stay as they are. */
  otherRegular: number;
  otherReplacements: number;
  /**
   * Whether all riders of other clubs are under 15. `null` when the preview
   * can't tell, because other clubs' birthdates aren't shared.
   */
  othersU15: boolean | null;
  /** For a group the club is joining: the group as `list_groups` shows it. */
  joining: GroupSummary | null;
  /**
   * The group was just created from the add row and never saved: cancelling
   * deletes it again, so it doesn't stay registered without riders.
   */
  created?: boolean;
  saving: boolean;
  error: string | null;
}

/** What the add row does with the typed name. */
type AddAction =
  | { kind: "create"; name: string }
  | { kind: "join"; group: GroupSummary }
  | { kind: "edit"; group: ClubGroup };

const sameMembers = (
  a: ReadonlyMap<string, boolean>,
  b: ReadonlyMap<string, boolean>,
) => a.size === b.size && [...a].every(([id, r]) => b.get(id) === r);

/** Whether one of the club's own riders is 15 or older (by birthdate). */
const ownOver15 = (
  own: ClubGroupMember[],
  competition: SystemStatus["competition"],
) =>
  own.some(
    (m) =>
      m.birthdate &&
      !isUnderAge(new Date(m.birthdate), GROUP_AGE_LIMIT, competition),
  );

/**
 * Whether a group in `category` is U15, from the birthday bounds the
 * category sets for the oldest rider (exact dates, like the server);
 * `null` if the category doesn't tell.
 */
const categoryIsU15 = (
  category: Category | undefined,
  competition: SystemStatus["competition"],
): boolean | null => {
  const from = category?.from_birthday;
  if (from && isUnderAge(new Date(from), GROUP_AGE_LIMIT, competition)) {
    return true;
  }
  // to_birthday is exclusive: the latest birthdate is the day before.
  const to = category?.to_birthday;
  if (
    to &&
    !isUnderAge(
      new Date(new Date(to).getTime() - DAY_MS),
      GROUP_AGE_LIMIT,
      competition,
    )
  ) {
    return false;
  }
  return null;
};

/**
 * Whether the oldest rider of `group` is under 15, `null` if unknown. Taken
 * from the group's category where it has one. Otherwise only the oldest
 * rider's age in whole years (`max_age`) is known, which is a day off for a
 * rider born exactly 15 years before the determining day.
 */
const oldestIsU15 = (
  group: ClubGroup,
  categories: Category[] | undefined,
  competition: SystemStatus["competition"],
): boolean | null => {
  const category = group.category
    ? categories?.find((c) => c.name === group.category)
    : undefined;
  const fromCategory = categoryIsU15(category, competition);
  if (fromCategory !== null) {
    return fromCategory;
  }
  if (group.max_age === null || group.max_age === undefined) {
    return null;
  }
  return group.max_age < GROUP_AGE_LIMIT;
};

/**
 * Whether `group` is U15, `null` without riders. Own riders are checked by
 * birthdate, like the category; other clubs' riders see `oldestIsU15`.
 */
const groupIsU15 = (
  group: ClubGroup,
  own: ClubGroupMember[],
  competition: SystemStatus["competition"],
  categories: Category[] | undefined,
): boolean | null => {
  if (ownOver15(own, competition)) {
    return false;
  }
  return oldestIsU15(group, categories, competition);
};

/**
 * Whether all riders of other clubs in `group` are under 15. The server only
 * shares the group's category and age (see `oldestIsU15`) and the own
 * riders' birthdates, so this is `null` when an own rider might be the
 * oldest.
 */
const othersAreU15 = (
  group: ClubGroup,
  own: ClubGroupMember[],
  competition: SystemStatus["competition"],
  categories: Category[] | undefined,
): boolean | null => {
  const oldestU15 = oldestIsU15(group, categories, competition);
  if (oldestU15 !== false) {
    return oldestU15;
  }
  // Someone is 15+. If it isn't an own rider, it is one of another club.
  const ownAllU15 = own.every(
    (m) =>
      m.birthdate &&
      isUnderAge(new Date(m.birthdate), GROUP_AGE_LIMIT, competition),
  );
  return ownAllU15 ? false : null;
};

/**
 * Lets a club create groups (Kleingruppe/Großgruppe), join groups of other
 * clubs and pick its own riders for them. Used on the club page and, with
 * `admin-mode`, in the admin's club view.
 */
@customElement("cup-club-group-manager")
export default class CupClubGroupManager extends LitElement {
  static override styles = [
    resetStyles,
    iconStyles,
    clubManagerStyles,
    css`
      .explain {
        margin: 0.5rem 0 0.5rem 1.25rem;

        & li {
          margin: 0.125rem 0;
        }
      }

      ul.names,
      ul.clubs {
        list-style: none;
      }

      ul.names > li {
        display: inline;
      }

      ul.names > li:not(:last-child)::after {
        content: ", ";
      }

      ul.clubs > li + li {
        margin-top: 0.125rem;
      }

      ul.clubs ul.names {
        display: inline;
      }

      tr.editing > td {
        background: color-mix(in srgb, var(--cup-blue-2) 18%, var(--cup-surface));
      }

      .pickerGrid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr));
        gap: 0.125rem 0.75rem;
        margin: 0.25rem 0;
      }

      .pick {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0 0.5rem;
        padding: 0.125rem 0.375rem;
        border: 1px solid transparent;
        border-radius: 0.25rem;

        & label {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          cursor: pointer;
        }

        & small {
          font-size: 0.8em;
        }
      }

      .pick.selected {
        background: color-mix(in srgb, var(--cup-blue-2) 40%, var(--cup-surface));
      }

      .pick.conflict {
        border-color: var(--cup-red);
      }

      .conflict-text {
        color: var(--cup-red);
      }

      .pickerHint {
        margin: 0.25rem 0;
        font-size: 0.9em;
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

  groups = new Task(this, {
    task: async ([clubId]): Promise<ClubGroup[]> => {
      if (!clubId) {
        return [];
      }
      return unwrap(
        await client.GET("/api/query/list_club_groups", {
          params: { query: { club_id: clubId } },
        }),
      );
    },
    args: () => [this.club?.id, this.refresh],
  });

  /** The club's own riders, sorted by name, for picking group members. */
  starters = new Task(this, {
    task: async ([clubId]): Promise<ClubStarter[]> => {
      if (!clubId) {
        return [];
      }
      const starters = unwrap(
        await client.GET("/api/query/list_club_starters", {
          params: { query: { club_id: clubId } },
        }),
      );
      return starters.sort(
        (a, b) =>
          a.lastname.localeCompare(b.lastname, "de") ||
          a.firstname.localeCompare(b.firstname, "de"),
      );
    },
    args: () => [this.club?.id, this.refresh],
  });

  /** All groups of the competition, to join one by its name. */
  allGroups = new Task(this, {
    task: async ([canEdit]): Promise<GroupSummary[]> => {
      if (!canEdit) {
        return [];
      }
      return unwrap(await client.GET("/api/query/list_groups"));
    },
    args: () => [this.canEdit, this.refresh],
  });

  /** All categories, to tell a group's age group from its category. */
  categories = new Task(this, {
    task: async (): Promise<Category[]> =>
      unwrap(await client.GET("/api/query/list_categories")),
    args: () => [],
  });

  @state() edits = new Map<string, GroupEdit>();
  /** A group the club is joining; it isn't in `groups` until saved. */
  @state() joinEdit: GroupEdit | null = null;
  @state() addMode = false;
  @state() addName = "";
  /** The type of a group created from the add row. */
  @state() addType: GroupActType = "group_small";
  @state() adding = false;
  @state() error: string | null = null;

  @query("#error") errorBanner?: HTMLElement;
  @query(".addRow input") addNameInput?: HTMLInputElement;
  @queryAll(".pickerRow") pickerRows!: NodeListOf<HTMLTableRowElement>;

  get canEdit() {
    return !!(this.systemStatus?.can_register_starter || this.user?.is_admin);
  }

  /** Renaming and deleting is up to the club that created the group. */
  canManage(group: ClubGroup) {
    return this.canEdit && (group.is_owner || !!this.user?.is_admin);
  }

  get columnCount() {
    return this.adminMode ? 6 : 5;
  }

  /** The data the open edits were last matched against. */
  private seenStarters?: ClubStarter[];
  private seenGroups?: ClubGroup[];
  private seenCategories?: Category[];

  override willUpdate() {
    const starters = this.starters.value;
    const groups = this.groups.value;
    const categories = this.categories.value;
    if (
      starters !== this.seenStarters ||
      groups !== this.seenGroups ||
      categories !== this.seenCategories
    ) {
      this.seenStarters = starters;
      this.seenGroups = groups;
      this.seenCategories = categories;
      this.reconcileEdits(starters, groups);
    }
  }

  /**
   * Matches open edits against reloaded data: riders deleted meanwhile (e.g.
   * in the starter table) leave the selection, and the riders of other clubs
   * are taken from the reloaded group.
   */
  reconcileEdits(starters?: ClubStarter[], groups?: ClubGroup[]) {
    const ids = starters && new Set(starters.map((starter) => starter.id));
    const edits = [...this.edits.values()];
    if (this.joinEdit) {
      edits.push(this.joinEdit);
    }
    for (const edit of edits) {
      if (ids) {
        for (const id of edit.members.keys()) {
          if (!ids.has(id)) {
            edit.members.delete(id);
          }
        }
        edit.original = new Map(
          [...edit.original].filter(([id]) => ids.has(id)),
        );
      }
      const group = groups?.find((g) => g.id === edit.id);
      if (group) {
        const own = this.ownMembers(group);
        const others = this.otherMembers(group);
        edit.otherRegular = others.filter((m) => !m.is_replacement).length;
        edit.otherReplacements = others.length - edit.otherRegular;
        edit.othersU15 = others.length
          ? othersAreU15(
              group,
              own,
              this.systemStatus?.competition,
              this.categories.value,
            )
          : true;
      }
    }
  }

  override render() {
    const groups = this.groups.value ?? [];
    return html`<h4>Gruppen</h4>
      ${this.adminMode ? nothing : this.renderExplanation()}
      <h5>Zusammenfassung</h5>
      ${this.renderSummary(groups)}

      <datalist id="groupNames">
        ${repeat(
          this.allGroups.value ?? [],
          (group) => group.id,
          (group) =>
            html`<option value=${group.group_name}>
              ${group.club_names.join(", ") || group.owner_club_name} ·
              ${groupSummaryText(group)}
            </option>`,
        )}
      </datalist>

      <h5>Gruppen</h5>
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
            <th>Gruppenname</th>
            <th>Kategorie</th>
            <th>Eigene FahrerInnen</th>
            <th>Andere Vereine</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.canEdit ? this.renderAddRow() : nothing}
          ${this.joinEdit ? this.renderEditRows(null, this.joinEdit) : nothing}
          ${this.renderGroupRows()}
        </tbody>
      </table>`;
  }

  renderExplanation() {
    const competition = this.systemStatus?.competition;
    const max = competition?.max_fee_per_starter;
    const fee = competition
      ? ` (${formatMoney(competition.fee_per_start)} pro Start${
          max === null || max === undefined
            ? ""
            : `, höchstens ${formatMoney(max)} pro FahrerIn insgesamt`
        })`
      : "";
    return html`<ul class="explain">
      <li>
        <strong>Kleingruppe (KG)</strong>: ${MIN_GROUP_SIZE}–${MAX_SMALL_GROUP_SIZE}
        FahrerInnen, <strong>Großgruppe (GG)</strong>: ab
        ${MAX_SMALL_GROUP_SIZE + 1} FahrerInnen. Die Art wählt der Verein, der
        die Gruppe erstellt; sie ändert sich nicht mit der Zahl der FahrerInnen.
        Passt die Größe nicht zur Art, wird die Gruppe trotzdem eingeplant, aber
        mit einem Hinweis. Gruppen mit weniger als ${MIN_GROUP_SIZE}
        FahrerInnen sind unvollständig und starten nicht.
      </li>
      <li>
        <strong>ErsatzfahrerInnen</strong> zählen nicht zur Gruppengröße, zahlen
        aber Startgeld: Jede Gruppe zählt für jede FahrerIn als ein Start${fee}.
      </li>
      <li>
        Die <strong>Altersklasse</strong> richtet sich nach der ältesten
        FahrerIn der Gruppe, ErsatzfahrerInnen eingeschlossen: Junior Expert,
        wenn alle unter 15 sind, sonst Expert.
      </li>
      <li>
        Jede FahrerIn kann in <strong>einer Kleingruppe und einer Großgruppe</strong>
        starten – auch als ErsatzfahrerIn.
      </li>
      <li>
        Der <strong>Gruppenname</strong> ist im ganzen Wettbewerb eindeutig.
        Vereine können <strong>gemeinsame Gruppen</strong> bilden: Ein Verein
        erstellt die Gruppe, die anderen geben denselben Namen ein, treten bei
        und wählen ihre eigenen FahrerInnen aus. Umbenennen und Löschen kann nur
        der Verein, der die Gruppe erstellt hat.
      </li>
    </ul>`;
  }

  renderSummary(groups: ClubGroup[]) {
    const complete = groups.filter((group) => group.category).length;
    const ownRiders = new Set(
      groups.flatMap((group) =>
        this.ownMembers(group).map((member) => member.starter_id),
      ),
    );
    return html`<table id="summary">
      <tr>
        <th>Gruppen</th>
        <td>${groups.length}</td>
      </tr>
      <tr>
        <th>Vollständig</th>
        <td>
          ${complete}/${groups.length} ${complete === groups.length ? "✔️" : "⌛"}
        </td>
      </tr>
      <tr>
        <th>Eigene FahrerInnen in Gruppen</th>
        <td>${ownRiders.size}</td>
      </tr>
    </table>`;
  }

  renderAddRow() {
    if (!this.addMode) {
      return html`<tr class="addRow fullRow">
        <td colspan=${this.columnCount}>
          <button
            class="addButton material-icon"
            title="Gruppe erstellen oder beitreten"
            aria-label="Gruppe erstellen oder beitreten"
            @click=${this.enterAddMode}
          >
            add
          </button>
        </td>
      </tr>`;
    }
    const action = this.addAction();
    const label =
      action?.kind === "join"
        ? "Beitreten"
        : action?.kind === "edit"
          ? "Bearbeiten"
          : "Gruppe erstellen";
    return html`<tr class="addRow">
      ${this.adminMode ? html`<td></td>` : nothing}
      <td>
        <label
          ><span>Gruppenname</span
          ><input
            type="text"
            list="groupNames"
            maxlength="60"
            placeholder="Gruppenname"
            .value=${this.addName}
            @input=${this.updateAddName}
            @keydown=${this.addNameKeydown}
        /></label>
      </td>
      <td colspan="3">${this.renderAddInfo(action)}</td>
      <td class="actionCol">
        <button
          class=${action?.kind === "create" ? "green" : "blue"}
          ?disabled=${!action || this.adding}
          @click=${this.commitAdd}
        >
          ${label}
        </button>
        <button
          class="red material-icon"
          title="Abbrechen"
          aria-label="Abbrechen"
          @click=${this.resetAdd}
        >
          cancel
        </button>
      </td>
    </tr>`;
  }

  renderAddInfo(action: AddAction | null) {
    switch (action?.kind) {
      case undefined:
        return html`<span class="muted"
          >Name einer neuen Gruppe – oder einer bestehenden Gruppe eines anderen
          Vereins, um ihr beizutreten.</span
        >`;
      case "create":
        return html`Neue Gruppe <strong>„${action.name}“</strong> als
          ${this.renderTypeSelect(this.addType, this.updateAddType)}. Danach
          werden die FahrerInnen ausgewählt.`;
      case "edit":
        return html`<strong>„${action.group.group_name}“</strong>: Der Verein
          ist schon in dieser Gruppe, sie wird zum Bearbeiten geöffnet.`;
      case "join": {
        const group = action.group;
        return html`Bestehende Gruppe <strong>„${group.group_name}“</strong>
          von ${group.owner_club_name ?? "unbekannt"}:
          ${groupSummaryText(group)}${
            group.club_names.length ? ` (${group.club_names.join(", ")})` : ""
          }. Beim Beitreten werden nur die eigenen FahrerInnen ausgewählt.`;
      }
    }
  }

  renderGroupRows() {
    const cols = this.columnCount;
    const groups = this.groups.value;
    return html`${
      this.groups.status === TaskStatus.ERROR
        ? html`<tr class="fullRow">
          <td colspan=${cols}>${errorMessage(this.groups.error)}</td>
        </tr>`
        : groups === undefined
          ? html`<tr class="fullRow">
            <td colspan=${cols}>Lädt Gruppen...</td>
          </tr>`
          : groups.length === 0 && !this.joinEdit
            ? html`<tr class="fullRow">
              <td colspan=${cols} class="muted">Noch keine Gruppen.</td>
            </tr>`
            : nothing
    }
    ${repeat(
      groups ?? [],
      (group) => group.id,
      (group) => {
        const edit = this.edits.get(group.id);
        return edit
          ? this.renderEditRows(group, edit)
          : this.renderGroupRow(group);
      },
    )}`;
  }

  renderGroupRow(group: ClubGroup) {
    const own = this.ownMembers(group);
    const others = this.otherMembers(group);
    const regular = group.members.filter((m) => !m.is_replacement).length;
    const replacements = group.members.length - regular;
    const isU15 = groupIsU15(
      group,
      own,
      this.systemStatus?.competition,
      this.categories.value,
    );
    const deleteBlocked = !this.user?.is_admin && others.length > 0;
    return html`<tr>
      ${this.adminMode ? html`<td>${group.id}</td>` : nothing}
      <td>
        <label><span>Gruppenname</span></label>
        <strong>${group.group_name}</strong> ${this.renderOwner(group)}
      </td>
      <td>
        <label><span>Kategorie</span></label>
        ${this.renderCategory(
          group.act_type,
          regular,
          replacements,
          isU15,
          group.category ?? null,
          group.conflict,
        )}
      </td>
      <td>
        <label><span>Eigene FahrerInnen</span></label>
        ${this.renderOwnMembers(own)}
      </td>
      <td>
        <label><span>Andere Vereine</span></label>
        ${this.renderOtherMembers(others)}
      </td>
      <td class="actionCol">
        ${
          this.canEdit
            ? html`<button
                class="blue material-icon"
                title=${
                  this.canManage(group)
                    ? "FahrerInnen auswählen, umbenennen oder Art ändern"
                    : "FahrerInnen auswählen"
                }
                aria-label="Bearbeiten"
                @click=${
                  // eslint-disable-next-line lit/no-template-arrow
                  () => this.enableEdit(group)
                }
              >
                edit
              </button>`
            : nothing
        }
        ${
          this.canManage(group)
            ? html`<button
                class="red material-icon"
                title=${
                  deleteBlocked
                    ? "Löschen nicht möglich: In der Gruppe sind noch FahrerInnen anderer Vereine."
                    : "Gruppe löschen"
                }
                aria-label="Gruppe löschen"
                ?disabled=${deleteBlocked}
                @click=${
                  // eslint-disable-next-line lit/no-template-arrow
                  () => this.deleteGroup(group)
                }
              >
                delete
              </button>`
            : nothing
        }
        ${
          this.canEdit && !group.is_owner && own.length > 0
            ? html`<button
                class="red material-icon"
                title="Gruppe verlassen"
                aria-label="Gruppe verlassen"
                @click=${
                  // eslint-disable-next-line lit/no-template-arrow
                  () => this.leaveGroup(group)
                }
              >
                logout
              </button>`
            : nothing
        }
      </td>
    </tr>${
      group.conflict
        ? html`<tr class="fullRow">
            <td colspan=${this.columnCount}>
              <small class="conflict-text" role="note">⚠️ ${group.conflict}</small>
            </td>
          </tr>`
        : nothing
    }`;
  }

  /** The main row and the rider picker of a group being edited or joined. */
  renderEditRows(group: ClubGroup | null, edit: GroupEdit) {
    const preview = this.preview(edit);
    const ownReplacements = [...edit.members.values()].filter((r) => r).length;
    return html`<tr class="editing fullRow">
        ${this.adminMode ? html`<td>${edit.id}</td>` : nothing}
        <td>
          ${
            edit.canRename
              ? html`<label
                  ><span>Gruppenname</span
                  ><input
                    type="text"
                    maxlength="60"
                    placeholder="Gruppenname"
                    .value=${edit.name}
                    @input=${
                      // eslint-disable-next-line lit/no-template-arrow
                      (e: InputEvent) => this.updateEditName(edit, e)
                    }
                    @keydown=${
                      // eslint-disable-next-line lit/no-template-arrow
                      (e: KeyboardEvent) =>
                        e.key === "Enter" && this.saveEdit(edit)
                    }
                /></label>`
              : html`<label><span>Gruppenname</span></label>
                  <strong>${edit.name}</strong>`
          }
          ${
            group
              ? this.renderOwner(group)
              : html`<br /><small class="muted"
                  >erstellt von
                  ${edit.joining?.owner_club_name ?? "unbekannt"}</small
                >`
          }
        </td>
        <td>
          <label><span>Kategorie (Vorschau)</span></label>
          ${
            edit.canRename
              ? html`${this.renderTypeSelect(edit.type, (e: Event) =>
                  this.updateEditType(edit, e),
                )}<br />`
              : nothing
          }
          ${this.renderCategory(
            edit.type,
            preview.regular,
            preview.replacements,
            preview.isU15,
          )}
          ${
            preview.isU15 === null && preview.regular >= MIN_GROUP_SIZE
              ? html`<br /><small class="muted"
                  >Die Altersklasse hängt vom Alter der FahrerInnen anderer
                  Vereine ab und steht nach dem Speichern fest.</small
                >`
              : nothing
          }
        </td>
        <td>
          <label><span>Eigene FahrerInnen</span></label>
          ${edit.members.size} ausgewählt${
            ownReplacements ? ` (davon ${ownReplacements} Ersatz)` : ""
          }
        </td>
        <td>
          <label><span>Andere Vereine</span></label>
          ${
            group
              ? this.renderOtherMembers(this.otherMembers(group))
              : edit.joining &&
                  edit.joining.regular_count + edit.joining.replacement_count >
                    0
                ? `${ridersText(
                    edit.joining.regular_count,
                    edit.joining.replacement_count,
                  )} (${edit.joining.club_names.join(", ")})`
                : html`<span class="muted">–</span>`
          }
        </td>
        <td class="actionCol">
          <button
            class="green material-icon"
            title="Speichern"
            aria-label="Speichern"
            ?disabled=${edit.saving}
            @click=${
              // eslint-disable-next-line lit/no-template-arrow
              () => this.saveEdit(edit)
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
              () => this.cancelEdit(edit)
            }
          >
            cancel
          </button>
        </td>
      </tr>
      <tr class="editing pickerRow fullRow" data-group=${edit.id}>
        <td colspan=${this.columnCount}>${this.renderPicker(edit)}</td>
      </tr>`;
  }

  /** Checkboxes for the club's own riders, each with an "Ersatz" toggle. */
  renderPicker(edit: GroupEdit) {
    const starters = this.starters.value ?? [];
    const type = edit.type;
    const elsewhere = this.membershipsElsewhere(edit.id);
    return html`${
      this.adminMode
        ? nothing
        : html`<p class="pickerHint">
          FahrerInnen von ${this.club?.name} auswählen. „Ersatz“ markiert
          ErsatzfahrerInnen: Sie zählen nicht zur Gruppengröße, aber zur
          Altersklasse.
        </p>`
    }
    ${
      this.starters.status === TaskStatus.ERROR
        ? html`<p class="error-banner">
          ${errorMessage(this.starters.error)}
        </p>`
        : starters.length
          ? html`<div class="pickerGrid">
            ${repeat(
              starters,
              (starter) => starter.id,
              (starter) =>
                this.renderPick(
                  edit,
                  starter,
                  type,
                  elsewhere.get(starter.id) ?? [],
                ),
            )}
          </div>`
          : html`<p class="muted">
            ${
              this.starters.value
                ? "Noch keine Starter angelegt. Lege die FahrerInnen zuerst unter „Starter“ an."
                : "Lädt Starter..."
            }
          </p>`
    }
    ${
      edit.error
        ? html`<p class="error-banner" role="alert">${edit.error}</p>`
        : nothing
    }`;
  }

  renderPick(
    edit: GroupEdit,
    starter: ClubStarter,
    type: ActType,
    elsewhere: { group_name: string; act_type: ActType }[],
  ) {
    const selected = edit.members.has(starter.id);
    const u15 = isUnderAge(
      new Date(starter.birthdate),
      GROUP_AGE_LIMIT,
      this.systemStatus?.competition,
    );
    const conflict = selected
      ? elsewhere.find((group) => group.act_type === type)
      : undefined;
    const others = elsewhere
      .filter((group) => group !== conflict)
      .map((group) => `${actTypeShort[group.act_type]} „${group.group_name}“`)
      .join(", ");
    return html`<div
      class="pick ${selected ? "selected" : ""} ${conflict ? "conflict" : ""}"
    >
      <label>
        <input
          type="checkbox"
          .checked=${selected}
          @change=${
            // eslint-disable-next-line lit/no-template-arrow
            (e: Event) => this.toggleMember(edit, starter.id, e)
          }
        />
        ${starter.firstname} ${starter.lastname}
      </label>
      <small class="muted">${u15 ? "U15" : "15+"}</small>
      <label title="ErsatzfahrerIn: zählt nicht zur Gruppengröße">
        <input
          type="checkbox"
          .checked=${edit.members.get(starter.id) ?? false}
          ?disabled=${!selected}
          @change=${
            // eslint-disable-next-line lit/no-template-arrow
            (e: Event) => this.toggleReplacement(edit, starter.id, e)
          }
        />
        Ersatz
      </label>
      ${
        conflict
          ? html`<small
              class="conflict-text"
              title="Jede FahrerIn kann nur in einer Kleingruppe und einer Großgruppe starten."
              >schon in ${actTypeLabels[conflict.act_type]}
              „${conflict.group_name}“</small
            >`
          : nothing
      }
      ${others ? html`<small class="muted">auch in ${others}</small>` : nothing}
    </div>`;
  }

  renderOwner(group: ClubGroup) {
    return group.is_owner
      ? html`<span
          class="badge"
          title="Dieser Verein hat die Gruppe erstellt und kann sie umbenennen oder löschen."
          >Ersteller</span
        >`
      : html`<br /><small class="muted"
          >erstellt von ${group.owner_club_name ?? "unbekannt"}</small
        >`;
  }

  /** A `<select>` of the group types. */
  renderTypeSelect(type: GroupActType, onChange: (e: Event) => void) {
    const options = groupTypeChoices.map(
      ([value, label]) =>
        html`<option value=${value} ?selected=${value === type}>${label}</option>`,
    );
    return html`<select aria-label="Art der Gruppe" @change=${onChange}>
      ${options}
    </select>`;
  }

  /**
   * "KG Junior Expert · 7 Fahrer + 1 Ersatz", or a warning for incomplete groups and
   * groups without category. `category` is `undefined` for previews. Groups
   * whose size doesn't fit their type get a hint below.
   */
  renderCategory(
    type: ActType,
    regular: number,
    replacements: number,
    isU15: boolean | null,
    category?: string | null,
    conflict?: string | null,
  ) {
    const text = describeGroup(type, regular, replacements, isU15);
    if (regular < MIN_GROUP_SIZE) {
      return html`<span class="warn">⌛ ${text}</span>`;
    }
    const sizeWarning = groupSizeWarning(type, regular);
    const hint = sizeWarning
      ? html`<br /><small
            class="warn"
            title="Die Gruppe ist trotzdem eingeplant. Fehlen noch FahrerInnen, oder passt die andere Art?"
            >⚠️ ${sizeWarning}</small
          >`
      : nothing;
    if (category === undefined) {
      return html`${text}${hint}`;
    }
    if (conflict) {
      return html`<span class="warn" title=${conflict}
        >⌛ ${text} – Doppelstart</span
      >`;
    }
    if (category === null) {
      return html`<span
        class="warn"
        title="Für diese Gruppe gibt es keine passende Kategorie. Bitte wende dich an den Veranstalter."
        >⌛ ${text} – keine Kategorie</span
      >`;
    }
    return html`<span title="Kategorie ${category}">✔️ ${text}</span>${hint}`;
  }

  renderOwnMembers(members: ClubGroupMember[]) {
    if (!members.length) {
      return html`<span class="muted">–</span>`;
    }
    return html`<ul class="names">
      ${repeat(
        members,
        (member) => member.starter_id,
        // No whitespace before </li>: the ", " separator follows it.
        (member) => html`<li>${this.renderName(member)}</li>`,
      )}
    </ul>`;
  }

  /** "Vorname Nachname", with an "Ersatz" badge for replacement riders. */
  renderName(member: ClubGroupMember) {
    return html`${member.firstname} ${member.lastname}${
      member.is_replacement
        ? html` <span class="badge muted">Ersatz</span>`
        : nothing
    }`;
  }

  /** Riders of other clubs, one line per club: "A B, C D (Verein)". */
  renderOtherMembers(members: ClubGroupMember[]) {
    if (!members.length) {
      return html`<span class="muted">–</span>`;
    }
    const byClub = new Map<string, ClubGroupMember[]>();
    for (const member of members) {
      byClub.set(member.club_name, [
        ...(byClub.get(member.club_name) ?? []),
        member,
      ]);
    }
    return html`<ul class="clubs">
      ${repeat(
        byClub,
        ([club]) => club,
        ([club, clubMembers]) =>
          html`<li>
            ${this.renderOwnMembers(clubMembers)}
            <span class="muted">(${club})</span>
          </li>`,
      )}
    </ul>`;
  }

  ownMembers(group: ClubGroup) {
    return group.members.filter((m) => m.club_id === this.club?.id);
  }

  otherMembers(group: ClubGroup) {
    return group.members.filter((m) => m.club_id !== this.club?.id);
  }

  /** For each own rider: the other groups they are in. */
  membershipsElsewhere(groupId: string) {
    const memberships = new Map<string, ClubGroup[]>();
    for (const group of this.groups.value ?? []) {
      if (group.id === groupId) {
        continue;
      }
      for (const member of this.ownMembers(group)) {
        memberships.set(member.starter_id, [
          ...(memberships.get(member.starter_id) ?? []),
          group,
        ]);
      }
    }
    return memberships;
  }

  /** Size, type and age group of an edited group, as far as known. */
  preview(edit: GroupEdit) {
    const competition = this.systemStatus?.competition;
    const starters = new Map(
      (this.starters.value ?? []).map((starter) => [starter.id, starter]),
    );
    let regular = edit.otherRegular;
    let replacements = edit.otherReplacements;
    let ownOver15 = false;
    for (const [starterId, isReplacement] of edit.members) {
      if (isReplacement) {
        replacements++;
      } else {
        regular++;
      }
      const starter = starters.get(starterId);
      if (
        starter &&
        !isUnderAge(new Date(starter.birthdate), GROUP_AGE_LIMIT, competition)
      ) {
        ownOver15 = true;
      }
    }
    const hasOthers = edit.otherRegular + edit.otherReplacements > 0;
    const isU15 =
      ownOver15 || edit.othersU15 === false
        ? false
        : hasOthers
          ? edit.othersU15
          : edit.members.size > 0
            ? true
            : null;
    return { regular, replacements, isU15 };
  }

  /** What the add row does with the typed name, `null` without a name. */
  addAction(): AddAction | null {
    const name = normalizeGroupName(this.addName);
    if (!name) {
      return null;
    }
    // An exact match first, in case names differing only in case exist.
    const pick = <T extends { group_name: string }>(list?: T[]) =>
      list?.find((group) => group.group_name === name) ??
      list?.find((group) => sameGroupName(group.group_name, name));
    const own = pick(this.groups.value);
    if (own) {
      return { kind: "edit", group: own };
    }
    const other = pick(this.allGroups.value);
    return other ? { kind: "join", group: other } : { kind: "create", name };
  }

  async enterAddMode() {
    this.addMode = true;
    this.allGroups.run();
    await this.updateComplete;
    this.addNameInput?.focus();
  }

  resetAdd() {
    this.addMode = false;
    this.addName = "";
    this.addType = "group_small";
  }

  updateAddName(e: InputEvent) {
    this.addName = (e.target as HTMLInputElement).value;
  }

  updateAddType(e: Event) {
    this.addType = selectedGroupType(e);
  }

  addNameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      this.commitAdd();
    } else if (e.key === "Escape") {
      this.resetAdd();
    }
  }

  async commitAdd() {
    const action = this.addAction();
    if (!action || !this.club || this.adding) {
      return;
    }
    switch (action.kind) {
      case "edit":
        if (!this.edits.has(action.group.id)) {
          this.enableEdit(action.group);
        }
        this.resetAdd();
        return;
      case "join":
        this.joinEdit = {
          ...this.newEdit(
            action.group.id,
            action.group.group_name,
            isGroupActType(action.group.act_type)
              ? action.group.act_type
              : "group_small",
          ),
          canRename: false,
          isOwner: false,
          otherRegular: action.group.regular_count,
          otherReplacements: action.group.replacement_count,
          othersU15:
            action.group.regular_count + action.group.replacement_count > 0
              ? null
              : true,
          joining: action.group,
        };
        this.resetAdd();
        return;
      case "create":
        this.adding = true;
        try {
          const { act_id } = unwrap(
            await client.POST("/api/command/create_club_group", {
              body: {
                club_id: this.club.id,
                group_name: action.name,
                act_type: this.addType,
              },
            }),
          );
          // Pick the riders right away; the row appears after the reload.
          this.edits.set(act_id, {
            ...this.newEdit(act_id, action.name, this.addType),
            created: true,
          });
          this.resetAdd();
          this.clearError();
          this.dataChanged();
        } catch (error) {
          // Another club may have taken the name meanwhile: reload, so the
          // add row offers to join that group instead.
          await Promise.all([this.allGroups.run(), this.groups.run()]);
          const retry = this.addAction();
          this.showError(
            retry?.kind === "join"
              ? `Die Gruppe „${retry.group.group_name}“ gibt es schon – du kannst ihr beitreten.`
              : errorMessage(error),
          );
        } finally {
          this.adding = false;
        }
    }
  }

  /** Edit state of a group without riders, owned by this club. */
  newEdit(id: string, name: string, type: GroupActType): GroupEdit {
    return {
      id,
      originalName: name,
      name,
      originalType: type,
      type,
      canRename: true,
      isOwner: true,
      original: new Map(),
      members: new Map(),
      otherRegular: 0,
      otherReplacements: 0,
      othersU15: true,
      joining: null,
      saving: false,
      error: null,
    };
  }

  enableEdit(group: ClubGroup) {
    const own = this.ownMembers(group);
    const others = this.otherMembers(group);
    const members = new Map(own.map((m) => [m.starter_id, m.is_replacement]));
    const type = isGroupActType(group.act_type)
      ? group.act_type
      : "group_small";
    this.edits.set(group.id, {
      id: group.id,
      originalName: group.group_name,
      name: group.group_name,
      originalType: type,
      type,
      canRename: this.canManage(group),
      isOwner: group.is_owner,
      original: new Map(members),
      members,
      otherRegular: others.filter((m) => !m.is_replacement).length,
      otherReplacements: others.filter((m) => m.is_replacement).length,
      othersU15: others.length
        ? othersAreU15(
            group,
            own,
            this.systemStatus?.competition,
            this.categories.value,
          )
        : true,
      joining: null,
      saving: false,
      error: null,
    });
    this.requestUpdate();
  }

  async cancelEdit(edit: GroupEdit) {
    if (this.joinEdit === edit) {
      this.joinEdit = null;
    }
    this.edits.delete(edit.id);
    this.requestUpdate();
    // A group created just now and left without riders is deleted again, so
    // it doesn't keep its name reserved and count as an incomplete group.
    if (
      edit.created &&
      edit.original.size === 0 &&
      edit.otherRegular + edit.otherReplacements === 0
    ) {
      try {
        unwrap(
          await client.POST("/api/command/delete_club_group", {
            body: { act_id: edit.id },
          }),
        );
        this.clearError();
      } catch (error) {
        this.showError(
          `Die leere Gruppe „${edit.originalName}“ konnte nicht gelöscht werden: ${errorMessage(error)}`,
        );
      }
      this.dataChanged();
    }
  }

  updateEditName(edit: GroupEdit, e: InputEvent) {
    edit.name = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateEditType(edit: GroupEdit, e: Event) {
    edit.type = selectedGroupType(e);
    this.requestUpdate();
  }

  toggleMember(edit: GroupEdit, starterId: string, e: Event) {
    if ((e.target as HTMLInputElement).checked) {
      edit.members.set(starterId, false);
    } else {
      edit.members.delete(starterId);
    }
    this.requestUpdate();
  }

  toggleReplacement(edit: GroupEdit, starterId: string, e: Event) {
    if (edit.members.has(starterId)) {
      edit.members.set(starterId, (e.target as HTMLInputElement).checked);
    }
    this.requestUpdate();
  }

  async saveEdit(edit: GroupEdit) {
    if (!this.club || edit.saving) {
      return;
    }
    const name = normalizeGroupName(edit.name);
    const rename = edit.canRename && name !== edit.originalName;
    const typeChanged = edit.canRename && edit.type !== edit.originalType;
    const membersChanged = !sameMembers(edit.original, edit.members);
    const changed = rename || typeChanged || membersChanged;
    if (rename && !name) {
      return this.showEditError(edit, "Bitte gib einen Gruppennamen an.");
    }
    if (edit.joining && edit.members.size === 0) {
      return this.showEditError(
        edit,
        "Wähle mindestens eine FahrerIn aus, um der Gruppe beizutreten.",
      );
    }
    if (
      membersChanged &&
      edit.members.size === 0 &&
      !edit.isOwner &&
      !confirm(
        `Ohne eigene FahrerInnen verlässt ${this.club.name} die Gruppe „${edit.originalName}“. Fortfahren?`,
      )
    ) {
      return;
    }

    edit.saving = true;
    edit.error = null;
    this.requestUpdate();
    let saved = false;
    try {
      if (rename) {
        unwrap(
          await client.POST("/api/command/rename_club_group", {
            body: { act_id: edit.id, group_name: name },
          }),
        );
        // A retry after failing to save the riders doesn't rename again.
        edit.originalName = name;
        saved = true;
      }
      let warning: string | null | undefined;
      if (typeChanged) {
        ({ warning } = unwrap(
          await client.POST("/api/command/set_club_group_type", {
            body: { act_id: edit.id, act_type: edit.type },
          }),
        ));
        edit.originalType = edit.type;
        saved = true;
      }
      // Saving the riders checks the final state again.
      if (membersChanged) {
        ({ warning } = unwrap(
          await client.POST("/api/command/set_club_group_members", {
            body: {
              club_id: this.club.id,
              act_id: edit.id,
              members: [...edit.members].map(
                ([starter_id, is_replacement]) => ({
                  starter_id,
                  is_replacement,
                }),
              ),
            },
          }),
        ));
      }
      // Saved: cancelling below must not delete a group created just now.
      edit.created = false;
      this.cancelEdit(edit);
      // Saved, but a rider is now also in another group of the same type.
      if (warning) {
        this.showError(warning);
      } else if (changed) {
        this.clearError();
      }
      if (changed) {
        this.dataChanged();
      }
    } catch (error) {
      this.showEditError(edit, errorMessage(error));
      if (saved) {
        this.dataChanged();
      }
    } finally {
      edit.saving = false;
      this.requestUpdate();
    }
  }

  async deleteGroup(group: ClubGroup) {
    if (
      !confirm(
        `Gruppe „${group.group_name}“ wirklich löschen?\nDie FahrerInnen bleiben angemeldet, nur die Gruppe wird entfernt.`,
      )
    ) {
      return;
    }
    try {
      unwrap(
        await client.POST("/api/command/delete_club_group", {
          body: { act_id: group.id },
        }),
      );
      this.edits.delete(group.id);
      this.clearError();
      this.dataChanged();
    } catch (error) {
      this.showError(errorMessage(error));
    }
  }

  /** Removes all own riders from a group of another club. */
  async leaveGroup(group: ClubGroup) {
    if (
      !this.club ||
      !confirm(
        `Gruppe „${group.group_name}“ verlassen?\nAlle FahrerInnen von ${this.club.name} werden aus der Gruppe entfernt.`,
      )
    ) {
      return;
    }
    try {
      unwrap(
        await client.POST("/api/command/set_club_group_members", {
          body: { club_id: this.club.id, act_id: group.id, members: [] },
        }),
      );
      this.edits.delete(group.id);
      this.clearError();
      this.dataChanged();
    } catch (error) {
      this.showError(errorMessage(error));
    }
  }

  clearError() {
    this.error = null;
  }

  async showError(message: string) {
    this.error = message;
    await this.updateComplete;
    this.errorBanner?.scrollIntoView({ block: "nearest" });
  }

  async showEditError(edit: GroupEdit, message: string) {
    edit.error = message;
    this.requestUpdate();
    await this.updateComplete;
    [...this.pickerRows]
      .find((row) => row.dataset.group === edit.id)
      ?.querySelector(".error-banner")
      ?.scrollIntoView({ block: "nearest" });
  }

  /**
   * Reloads after a successful change. Inside cup-club-manager, the club
   * manager cancels the event and reloads all managers (groups change fees
   * and acts); standalone, only this manager reloads.
   */
  dataChanged() {
    const event = new Event("club-data-changed", {
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    if (this.dispatchEvent(event)) {
      this.groups.run();
      this.starters.run();
      this.allGroups.run();
    }
  }
}
