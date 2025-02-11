import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { consume } from "@lit/context";
import { Task } from "@lit/task";
import { Club, clubContext } from "../../contexts/club";
import { SystemStatus, systemStatusContext } from "../../contexts/systemStatus";
import { User, userContext } from "../../contexts/user";

type Starter = { birthdate: Date } & Omit<
  components["schemas"]["ClubStarter"],
  "birthdate"
>;

type MaybeNewStarter = Omit<Omit<Starter, "id">, "club_id">;

@customElement("cup-club-starter-manager")
export default class CupClubStarterManager extends LitElement {
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

    h3 {
      margin-bottom: 0.5em;
    }
    h4,
    h5,
    p {
      margin-top: 1em;
      margin-bottom: 0.5em;
    }

    .blue {
      background: #002d56;
      color: #fff;
    }

    .green {
      background: #009036;
      color: #fff;
    }

    .red {
      background: #e2001a;
      color: #fff;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    #summary {
      width: auto;
    }

    #summary th {
      text-align: left;
    }

    tr {
      border: 0.1rem solid #ddd;
      border-radius: 0.5rem;
    }

    tbody tr:nth-child(odd) {
      background: #f8f8f8;
    }

    tbody tr:hover {
      background: #eee;
    }

    th,
    td {
      padding: 0.25rem;
      height: 100%;
      border: 0.1rem solid #ddd;
    }

    label {
      display: flex;
      flex-direction: column;

      & span {
        display: none;
      }
    }

    input,
    select,
    button {
      padding: 0.25rem;
    }

    button {
      border-radius: 0.5rem;
      cursor: pointer;
      padding: 0.25rem 0.75rem;
      border: none;
      border-radius: 100vh;
    }

    #addStarterButton {
      width: 100%;
      height: 100%;
      border-radius: 0;
    }

    /* If screen narrower than 1200px */
    @media screen and (max-width: 1200px) {
      table {
        display: block;
      }
      tbody {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
        gap: 1rem;
      }

      thead {
        display: none;
      }

      tr {
        display: flex;
        flex-direction: column;
        padding: 0.5rem;
      }

      tbody tr:nth-child(odd) {
        background: none;
      }

      tbody tr:hover {
        background: none;
      }

      th,
      td {
        border: none;
      }

      label span {
        display: block;
        font-size: 0.8rem;
      }
    }

    @media print {
      #addStarterRow,
      .actionCol {
        display: none;
      }
    }
  `;

  @consume({ context: clubContext, subscribe: true }) club: Club | null = null;

  @consume({ context: systemStatusContext, subscribe: true })
  systemStatus: SystemStatus | null = null;
  @consume({ context: userContext, subscribe: true }) user: User | null = null;

  @property({ type: Boolean, attribute: "admin-mode" }) adminMode = false;

  starters = new Task(this, {
    task: async ([clubId]) => {
      if (!clubId) {
        return [];
      }
      const resp = await client.GET("/api/query/list_club_starters", {
        params: { query: { club_id: clubId } },
      });
      if (resp.error) {
        throw new Error((resp.error as any).message);
      }
      return resp.data.map((starter) => {
        const birthdate = new Date(starter.birthdate);
        return { ...starter, birthdate };
      });
    },
    args: () => [this.club?.id],
  });

  @state() starterEdits = new Map<string, Starter>();
  @state() addStarter: MaybeNewStarter = {
    firstname: "",
    lastname: "",
    birthdate: new Date(),
    single_sonderpokal: false,
    single_male: false,
    single_female: false,
    pair_sonderpokal: false,
    pair: false,
    partner_name: "",
  };

  @state() addStarterMode = false;

  override render() {
    return html`<h4>Starter</h4>
      <h5>Zusammenfassung</h5>

      <datalist id="clubStarters">
        ${this.starters.value?.map(
          (starter) =>
            html`<option
              value="${starter.firstname} ${starter.lastname}"
            ></option>`
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
            ${(this.starters.value || []).reduce(
              (acc, starter) => acc + getStarterPrice(starter),
              0
            )}€
          </td>
        </tr>
        <tr>
          <th>Bezahlt</th>
          <td>
            ${this.club?.payment?.toFixed(2).toString().replace(".", ",") || 0}€${this.adminMode
              ? html` <button @click=${this.pay}>Betrag aktualisieren</button>`
              : nothing}
          </td>
        </tr>
      </table>

      <h5>Starter</h5>
      <table>
        <thead>
          <tr>
            ${this.adminMode ? html`<th>ID</th>` : nothing}
            <th>Vorname</th>
            <th>Nachname</th>
            <th>Geburtstag</th>
            <th>Einzel-Kategorie</th>
            <th>Einzel M</th>
            <th>Einzel W</th>
            <th>Paar-Kategorie</th>
            <th>Paar</th>
            <th>Partner</th>
            ${this.adminMode ? html`<th>Partner ID</th>` : nothing}
            <th>Startgeld</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.systemStatus?.can_register_starter || this.user?.is_admin
            ? this.addStarterMode
              ? html`<tr id="addStarterRow">
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
                        .value=${this.addStarter.birthdate
                          .toISOString()
                          .slice(0, 10)}
                        @input=${this.updateAddStarterBirthdate}
                    /></label>
                  </td>
                  <td>
                    <label
                      ><span>Einzel-Kategorie</span
                      ><select @input=${this.updateAddStarterEinzelSonderpokal}>
                        <option
                          value="sonderpokal"
                          ?selected=${this.addStarter.single_sonderpokal}
                        >
                          Sonderpokal
                        </option>
                        <option
                          value="nachwuchscup"
                          ?selected=${!this.addStarter.single_sonderpokal}
                        >
                          Nachwuchscup
                        </option>
                      </select></label
                    >
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
                      ><span>Paar-Kategorie</span
                      ><select @input=${this.updateAddStarterPaarSonderpokal}>
                        <option
                          value="sonderpokal"
                          ?selected=${this.addStarter.pair_sonderpokal}
                        >
                          Sonderpokal
                        </option>
                        <option
                          value="nachwuchscup"
                          ?selected=${!this.addStarter.pair_sonderpokal}
                        >
                          Nachwuchscup
                        </option>
                      </select></label
                    >
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
                  <td>
                    <label
                      ><span>Partner ID</span>
                      <input
                        type="text"
                        .value=${this.addStarter.partner_id || ""}
                        @input=${this.updateAddStarterPartnerId}
                        placeholder="Partner ID"
                        list="clubStarters"
                        ?disabled=${!this.addStarter.pair}
                    /></label>
                  </td>
                  <td>
                    <label><span>Startgebühr</span></label> ${getStarterPrice(
                      this.addStarter
                    )}€
                  </td>
                  <td class="actionCol">
                    <button
                      class="green material-icon"
                      @click=${this.commitAddStarter}
                    >
                      save
                    </button>
                    <button
                      class="red material-icon"
                      @click=${this.resetAddStarter}
                    >
                      cancel
                    </button>
                  </td>
                </tr>`
              : html`<tr id="addStarterRow">
                  <td colspan=${this.adminMode ? 13 : 11}>
                    <button
                      id="addStarterButton"
                      class="material-icon"
                      @click=${() => (this.addStarterMode = true)}
                    >
                      add
                    </button>
                  </td>
                </tr>`
            : nothing}
          ${this.starters.render({
            complete: (starters) =>
              starters.map((starter) => {
                const editStarter = this.starterEdits.get(starter.id);
                return editStarter
                  ? html`<tr>
                      ${this.adminMode ? html`<td>${starter.id}</td>` : nothing}
                      <td>
                        <label
                          ><span>Vorname</span
                          ><input
                            type="text"
                            .value=${editStarter.firstname}
                            @input=${(e: InputEvent) =>
                              this.updateEditStarterFirstname(editStarter, e)}
                            placeholder="Vorname"
                        /></label>
                      </td>
                      <td>
                        <label
                          ><span>Nachname</span
                          ><input
                            type="text"
                            .value=${editStarter.lastname}
                            @input=${(e: InputEvent) =>
                              this.updateEditStarterLastname(editStarter, e)}
                            placeholder="Nachname"
                        /></label>
                      </td>
                      <td>
                        <label
                          ><span>Geburtstag</span
                          ><input
                            type="date"
                            .value=${editStarter.birthdate
                              .toISOString()
                              .slice(0, 10)}
                            @input=${(e: InputEvent) =>
                              this.updateEditStarterBirthdate(editStarter, e)}
                        /></label>
                      </td>
                      <td>
                        <label
                          ><span>Einzel Kategorie</span
                          ><select
                            @input=${(e: InputEvent) =>
                              this.updateEditStarterEinzelSonderpokal(
                                editStarter,
                                e
                              )}
                          >
                            <option
                              value="sonderpokal"
                              ?selected=${editStarter.single_sonderpokal}
                            >
                              Sonderpokal
                            </option>
                            <option
                              value="nachwuchscup"
                              ?selected=${!editStarter.single_sonderpokal}
                            >
                              Nachwuchscup
                            </option>
                          </select></label
                        >
                      </td>
                      <td>
                        <label
                          ><span>Einzel Männlich</span
                          ><input
                            type="checkbox"
                            ?checked=${editStarter.single_male}
                            @input=${(e: InputEvent) =>
                              this.updateEditStarterSingleMale(editStarter, e)}
                        /></label>
                      </td>
                      <td>
                        <label
                          ><span>Einzel Weiblich</span
                          ><input
                            type="checkbox"
                            ?checked=${editStarter.single_female}
                            @input=${(e: InputEvent) =>
                              this.updateEditStarterSingleFemale(
                                editStarter,
                                e
                              )}
                        /></label>
                      </td>
                      <td>
                        <label
                          ><span>Paar Kategorie</span
                          ><select
                            @input=${(e: InputEvent) =>
                              this.updateEditStarterPaarSonderpokal(
                                editStarter,
                                e
                              )}
                          >
                            <option
                              value="sonderpokal"
                              ?selected=${editStarter.pair_sonderpokal}
                            >
                              Sonderpokal
                            </option>
                            <option
                              value="nachwuchscup"
                              ?selected=${!editStarter.pair_sonderpokal}
                            >
                              Nachwuchscup
                            </option>
                          </select></label
                        >
                      </td>
                      <td>
                        <label
                          ><span>Paar</span
                          ><input
                            type="checkbox"
                            ?checked=${editStarter.pair}
                            @input=${(e: InputEvent) =>
                              this.updateEditStarterPair(editStarter, e)}
                        /></label>
                      </td>
                      <td>
                        <label
                          ><span>Partner Name</span
                          ><input
                            type="text"
                            value=${editStarter.partner_name || ""}
                            @input=${(e: InputEvent) =>
                              this.updateEditStarterPartnerName(editStarter, e)}
                            placeholder="Partner Name"
                            list="clubStarters"
                            ?disabled=${!editStarter.pair}
                        /></label>
                      </td>
                      ${this.adminMode
                        ? html`<td>
                            <label
                              ><span>Partner ID</span
                              ><input
                                type="text"
                                value=${editStarter.partner_id || ""}
                                @input=${(e: InputEvent) =>
                                  this.updateEditStarterPartnerId(
                                    editStarter,
                                    e
                                  )}
                                placeholder="Partner ID"
                                list="clubStarters"
                                ?disabled=${!editStarter.pair}
                            /></label>
                          </td>`
                        : nothing}
                      <td>
                        <label><span>Startgebühr</span></label>
                        ${getStarterPrice(editStarter)}€
                      </td>
                      <td class="actionCol">
                        <button
                          class="green material-icon"
                          @click=${() => this.commitStarterEdit(editStarter)}
                        >
                          save
                        </button>
                        <button
                          class="red material-icon"
                          @click=${() => this.disableStarterEdit(editStarter)}
                        >
                          cancel
                        </button>
                      </td>
                    </tr>`
                  : html`<tr>
                      ${this.adminMode ? html`<td>${starter.id}</td>` : nothing}
                      <td>
                        <label><span>Vorname</span></label> ${starter.firstname}
                      </td>
                      <td>
                        <label><span>Nachname</span></label> ${starter.lastname}
                      </td>
                      <td>
                        <label><span>Geburtstag</span></label>
                        ${starter.birthdate.toLocaleDateString()}
                      </td>
                      <td>
                        <label><span>Einzel-Kategorie</span></label>
                        ${starter.single_sonderpokal
                          ? "Sonderpokal"
                          : "Nachwuchscup"}
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
                        <label><span>Paar-Kategorie</span></label>
                        ${starter.pair_sonderpokal
                          ? "Sonderpokal"
                          : "Nachwuchscup"}
                      </td>
                      <td>
                        <label><span>Paar</span></label> ${starter.pair
                          ? "✔️"
                          : "-"}
                      </td>
                      <td>
                        <label><span>Partner</span></label> ${starter.pair &&
                        starter.partner_name
                          ? starter.resolved_partner_name
                            ? `✔️ ${starter.resolved_partner_name} (${starter.resolved_partner_club})`
                            : `⌛ ${starter.partner_name}`
                          : nothing}
                      </td>
                      ${this.adminMode
                        ? html`<td>
                            <label><span>Partner ID</span></label>
                            ${starter.pair && starter.partner_id
                              ? starter.partner_id
                              : nothing}
                          </td>`
                        : nothing}
                      <td>
                        <label><span>Startgebühr</span></label>
                        ${getStarterPrice(starter)}€
                      </td>
                      <td class="actionCol">
                        ${this.systemStatus?.can_register_starter ||
                        this.user?.is_admin
                          ? html` <button
                                @click=${() => this.enableStarterEdit(starter)}
                                class="blue material-icon"
                              >
                                edit
                              </button>
                              <button
                                @click=${() => this.deleteStarter(starter)}
                                class="red material-icon"
                              >
                                delete
                              </button>`
                          : nothing}
                      </td>
                    </tr>`;
              }),
            error: (error) => html`<p>${error}</p>`,
            pending: () => html`<p>Lädt Starter...</p>`,
          })}
        </tbody>
      </table>
      ${this.adminMode
        ? nothing
        : html`<p>
            <em
              >Paarkürpartner innerhalb eines Vereins werden automatisch
              verbunden. Vereinsübergreifende Paare werden vom Veranstalter
              verifiziert. Bis dies geschehen ist, wird der Partner mit einem ⌛
              markiert.</em
            >
          </p>`}`;
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
    if (!validateStarter(starter)) {
      return;
    }

    const resp = await client.POST("/api/command/edit_club_starter", {
      body: {
        ...starter,
        starter_id: starter.id,
        birthdate: starter.birthdate.toISOString(),
        partner_name: starter.partner_name ? starter.partner_name : null,
      },
    });
    if (resp.error) {
      alert(
        "Fehler beim Speichern: " + (resp.error as { message: string }).message
      );
      return;
    }
    this.starterEdits.delete(starter.id);
    this.starters.run();
  }

  async deleteStarter(starter: Starter) {
    if (
      !confirm(
        `Sicher, dass du ${starter.firstname} ${starter.lastname} löschen willst? Gib 'Ja' ein:`
      )
    ) {
      return;
    }
    const resp = await client.POST("/api/command/delete_club_starter", {
      body: { starter_id: starter.id },
    });
    if (resp.error) {
      alert("Fehler beim Löschen: " + resp.error);
      return;
    }
    this.starterEdits.delete(starter.id);
    this.starters.run();
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

  updateEditStarterEinzelSonderpokal(starter: Starter, e: InputEvent) {
    starter.single_sonderpokal =
      (e.target as HTMLSelectElement).value === "sonderpokal";
    this.requestUpdate();
  }

  updateEditStarterSingleMale(starter: Starter, e: InputEvent) {
    starter.single_male = (e.target as HTMLInputElement).checked;
    this.requestUpdate();
  }

  updateEditStarterSingleFemale(starter: Starter, e: InputEvent) {
    starter.single_female = (e.target as HTMLInputElement).checked;
    this.requestUpdate();
  }

  updateEditStarterPaarSonderpokal(starter: Starter, e: InputEvent) {
    starter.pair_sonderpokal =
      (e.target as HTMLSelectElement).value === "sonderpokal";
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

  updateAddStarterEinzelSonderpokal(e: InputEvent) {
    this.addStarter.single_sonderpokal =
      (e.target as HTMLSelectElement).value === "sonderpokal";
    this.requestUpdate();
  }

  updateAddStarterSingleMale(e: InputEvent) {
    this.addStarter.single_male = (e.target as HTMLInputElement).checked;
    this.requestUpdate();
  }

  updateAddStarterSingleFemale(e: InputEvent) {
    this.addStarter.single_female = (e.target as HTMLInputElement).checked;
    this.requestUpdate();
  }

  updateAddStarterPair(e: InputEvent) {
    this.addStarter.pair = (e.target as HTMLInputElement).checked;
    this.requestUpdate();
  }

  updateAddStarterPaarSonderpokal(e: InputEvent) {
    this.addStarter.pair_sonderpokal =
      (e.target as HTMLSelectElement).value === "sonderpokal";
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
    if (!this.club || !validateStarter(this.addStarter)) {
      return;
    }

    const resp = await client.POST("/api/command/add_club_starter", {
      body: {
        ...this.addStarter,
        club_id: this.club?.id,
        birthdate: this.addStarter.birthdate.toISOString(),
        partner_name: this.addStarter.partner_name
          ? this.addStarter.partner_name
          : null,
      },
    });

    if (resp.error) {
      alert("Fehler beim Speichern: " + resp.error);
      return;
    }
    this.starters.run();
    this.resetAddStarter();
  }

  resetAddStarter() {
    this.addStarter = {
      firstname: "",
      lastname: "",
      birthdate: new Date(),
      single_sonderpokal: false,
      single_male: false,
      single_female: false,
      pair_sonderpokal: false,
      pair: false,
      partner_name: "",
    };
    this.addStarterMode = false;
  }

  async pay() {
    if (!this.club) {
      return;
    }
    const amount = parseFloat(prompt("Betrag in Euro:")?.replace(",", ".") || "0");
    if (!amount) {
      alert("Ungültiger Betrag.");
      return;
    }
    const resp = await client.POST("/api/command/set_payment", {
      body: { club_id: this.club?.id, amount },
    });
    if (resp.error) {
      alert("Fehler beim Speichern: " + resp.error);
      return;
    }
    console.log(resp);
    alert(`Zahlung von ${amount}€ eingetragen.`);
    this.club.payment = amount;
    document.location.reload();
  }
}

export const getStarterPrice = (starter: MaybeNewStarter) => {
  const singlePricePerStart = starter.single_sonderpokal ? 12 : 10;
  const pairPricePerStart = starter.pair_sonderpokal ? 12 : 10;
  let price = 0;
  if (starter.single_male) {
    price += singlePricePerStart;
  }
  if (starter.single_female) {
    price += singlePricePerStart;
  }
  if (starter.pair) {
    price += pairPricePerStart;
  }
  return price;
};

const validateStarter = (starter: MaybeNewStarter) => {
  if (starter.single_male && starter.single_female) {
    alert("Ein Starter kann nicht in beiden Einzelkategorien starten.");
    return false;
  }

  if (!starter.firstname || !starter.lastname) {
    alert("Vorname und Nachname müssen angegeben werden.");
    return false;
  }

  if (starter.single_sonderpokal && starter.pair && !starter.pair_sonderpokal) {
    alert(
      "Einzel-Sonderpokal ist nur in Kombination mit Paar-Sonderpokal möglich."
    );
    return false;
  }
  return true;
};
