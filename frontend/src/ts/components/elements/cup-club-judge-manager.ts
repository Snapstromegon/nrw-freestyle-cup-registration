import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { client, components } from "../../apiClient";
import { consume } from "@lit/context";
import { Task } from "@lit/task";
import { Club, clubContext } from "../../contexts/club";
import { SystemStatus, systemStatusContext } from "../../contexts/systemStatus";

type Judge = { birthdate: Date } & Omit<
  components["schemas"]["ClubJudge"],
  "birthdate"
>;

const ALL_CATEGORIES = [
  "n_ew_u15",
  "n_ew_o15",
  "n_em_u15",
  "n_em_o15",
  "n_p_u15",
  "n_p_o15",
  "s_e_u15",
  "s_e_o15",
  "s_p_u15",
  "s_p_o15",
];

const ALL_JUDGE_PARTS = ["p", "t", "a"];

type MaybeNewJudge = Omit<Omit<Judge, "id">, "club_id">;

@customElement("cup-club-judge-manager")
export default class CupClubJudgeManager extends LitElement {
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

    .juryselect {
      & label {
        display: flex;
        flex-direction: row;
        flex-grow: 1;
        align-items: center;
        gap: 0.5rem;
      }
      & h6 {
        display: none;
      }

      & .type {
        display: flex;
        gap: 0.5rem;
        flex-grow: 1;
        justify-content: center;
      }
    }

    label {
      display: flex;
      flex-direction: column;

      & span {
        display: none;
      }

      & .type-label {
        display: inline;
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

    #addJudgeButton {
      width: 100%;
      height: 100%;
      border-radius: 0;
    }

    /* If screen narrower than 1200px */
    @media screen and (max-width: 1600px) {
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

      tbody tr:hover,
      tbody tr:nth-child(odd) {
        background: none;
      }

      td,
      th {
        border: none;
      }

      .juryselect {
        display: flex;
        gap: 0.5rem;
        flex-direction: row;
        flex-wrap: wrap;

        & h6 {
          display: block;
          width: 100%;
          font-size: 0.8rem;
        }
      }

      label span {
        display: block;
        font-size: 0.8rem;
      }
    }

    @media print {
      #addJudgeRow,
      .actionCol {
        display: none;
      }
    }
  `;

  @consume({ context: clubContext, subscribe: true }) club: Club | null = null;

  @consume({ context: systemStatusContext, subscribe: true })
  systemStatus: SystemStatus | null = null;

  judges = new Task(this, {
    task: async ([clubId]) => {
      if (!clubId) {
        return [];
      }
      let resp = await client.GET("/api/query/list_club_judges", {
        params: { query: { club_id: clubId } },
      });
      if (resp.error) {
        throw new Error((resp.error as any).message);
      }
      return resp.data.map((judge) => {
        const birthdate = new Date(judge.birthdate);
        return { ...judge, birthdate };
      });
    },
    args: () => [this.club?.id],
  });

  @state() judgeEdits: Map<string, Judge> = new Map();
  @state() addJudge: MaybeNewJudge = {
    firstname: "",
    lastname: "",
    mail: "",
    birthdate: new Date(),
    n_em_u15_p: false,
    n_em_u15_p_hosp: false,
    n_em_u15_t: false,
    n_em_u15_t_hosp: false,
    n_em_u15_a: false,
    n_em_u15_a_hosp: false,
    n_em_o15_p: false,
    n_em_o15_p_hosp: false,
    n_em_o15_t: false,
    n_em_o15_t_hosp: false,
    n_em_o15_a: false,
    n_em_o15_a_hosp: false,
    n_ew_u15_p: false,
    n_ew_u15_p_hosp: false,
    n_ew_u15_t: false,
    n_ew_u15_t_hosp: false,
    n_ew_u15_a: false,
    n_ew_u15_a_hosp: false,
    n_ew_o15_p: false,
    n_ew_o15_p_hosp: false,
    n_ew_o15_t: false,
    n_ew_o15_t_hosp: false,
    n_ew_o15_a: false,
    n_ew_o15_a_hosp: false,
    n_p_u15_p: false,
    n_p_u15_p_hosp: false,
    n_p_u15_t: false,
    n_p_u15_t_hosp: false,
    n_p_u15_a: false,
    n_p_u15_a_hosp: false,
    n_p_o15_p: false,
    n_p_o15_p_hosp: false,
    n_p_o15_t: false,
    n_p_o15_t_hosp: false,
    n_p_o15_a: false,
    n_p_o15_a_hosp: false,
    s_e_u15_p: false,
    s_e_u15_p_hosp: false,
    s_e_u15_t: false,
    s_e_u15_t_hosp: false,
    s_e_u15_a: false,
    s_e_u15_a_hosp: false,
    s_e_o15_p: false,
    s_e_o15_p_hosp: false,
    s_e_o15_t: false,
    s_e_o15_t_hosp: false,
    s_e_o15_a: false,
    s_e_o15_a_hosp: false,
    s_p_u15_p: false,
    s_p_u15_p_hosp: false,
    s_p_u15_t: false,
    s_p_u15_t_hosp: false,
    s_p_u15_a: false,
    s_p_u15_a_hosp: false,
    s_p_o15_p: false,
    s_p_o15_p_hosp: false,
    s_p_o15_t: false,
    s_p_o15_t_hosp: false,
    s_p_o15_a: false,
    s_p_o15_a_hosp: false,
  };

  @state() addJudgeMode = false;

  get judgingCount() {
    return this.judges.value?.filter(judge => 
      judge.n_em_u15_p || judge.n_em_u15_t || judge.n_em_u15_a ||
      judge.n_em_o15_p || judge.n_em_o15_t || judge.n_em_o15_a ||
      judge.n_ew_u15_p || judge.n_ew_u15_t || judge.n_ew_u15_a ||
      judge.n_ew_o15_p || judge.n_ew_o15_t || judge.n_ew_o15_a ||
      judge.n_p_u15_p || judge.n_p_u15_t || judge.n_p_u15_a ||
      judge.n_p_o15_p || judge.n_p_o15_t || judge.n_p_o15_a ||
      judge.s_e_u15_p || judge.s_e_u15_t || judge.s_e_u15_a ||
      judge.s_e_o15_p || judge.s_e_o15_t || judge.s_e_o15_a ||
      judge.s_p_u15_p || judge.s_p_u15_t || judge.s_p_u15_a ||
      judge.s_p_o15_p || judge.s_p_o15_t || judge.s_p_o15_a
    ).length;
  }

  get hospCount() {
    return this.judges.value?.filter(judge =>
      judge.n_em_u15_p_hosp || judge.n_em_u15_t_hosp || judge.n_em_u15_a_hosp ||
      judge.n_em_o15_p_hosp || judge.n_em_o15_t_hosp || judge.n_em_o15_a_hosp ||
      judge.n_ew_u15_p_hosp || judge.n_ew_u15_t_hosp || judge.n_ew_u15_a_hosp ||
      judge.n_ew_o15_p_hosp || judge.n_ew_o15_t_hosp || judge.n_ew_o15_a_hosp ||
      judge.n_p_u15_p_hosp || judge.n_p_u15_t_hosp || judge.n_p_u15_a_hosp ||
      judge.n_p_o15_p_hosp || judge.n_p_o15_t_hosp || judge.n_p_o15_a_hosp ||
      judge.s_e_u15_p_hosp || judge.s_e_u15_t_hosp || judge.s_e_u15_a_hosp ||
      judge.s_e_o15_p_hosp || judge.s_e_o15_t_hosp || judge.s_e_o15_a_hosp ||
      judge.s_p_u15_p_hosp || judge.s_p_u15_t_hosp || judge.s_p_u15_a_hosp ||
      judge.s_p_o15_p_hosp || judge.s_p_o15_t_hosp || judge.s_p_o15_a_hosp
    ).length;
  }

  override render() {
    return html`<h4>Jury</h4>

      <p>
        Die Altersgruppen sind nur in U15 und 15+ geteilt. Eine genauere
        Einteilung wird nach Meldeschluss vorgenommen. Wir achten darauf, dass
        alle Judges mit ausreichend Abstand zur eigenen Kür werten.
      </p>
      <p>
        Die Auswahl besteht aus "-" (Nichts), "✔️" (Judge) und "👀" (Judge
        Hospitation). Gewertet wird in "P" (Performance), "T" (Technik) und "A"
        (Abstiege).
      </p>

      <h5>Zusammenfassung</h5>

      <table id="summary">
        <tr>
          <th>Judges (ohne Hospitation)</th>
          <td>${this.judgingCount}</td>
        </tr>
        <tr>
          <th>Judges (Hospitation)</th>
          <td>${this.hospCount}</td>
        </tr>
        <tr>
          <th>Judges (gesamt)</th>
          <td>${this.judges.value?.length}</td>
        </tr>
      </table>

      <h5>Judge</h5>
      <table>
        <thead>
          <tr>
            <th rowspan="4">Vorname</th>
            <th rowspan="4">Nachname</th>
            <th rowspan="4">Email</th>
            <th rowspan="4">Geburtstag</th>
            <th colspan="6">Nachwuchscup</th>
            <th colspan="4">Sonderpokal</th>
            <th rowspan="4"></th>
          </tr>
          <tr>
            <th colspan="2">Einzel W</th>
            <th colspan="2">Einzel M</th>
            <th colspan="2">Paar</th>
            <th colspan="2">Einzel</th>
            <th colspan="2">Paar</th>
          </tr>
          <tr>
            <th>U15</th>
            <th>15+</th>
            <th>U15</th>
            <th>15+</th>
            <th>U15</th>
            <th>15+</th>
            <th>U15</th>
            <th>15+</th>
            <th>U15</th>
            <th>15+</th>
          </tr>
        </thead>
        <tbody>
          ${this.systemStatus?.can_register_judge
            ? this.addJudgeMode
              ? html`<tr id="addJudgeRow">
                  <td>
                    <label
                      ><span>Vorname</span
                      ><input
                        type="text"
                        .value=${this.addJudge.firstname}
                        @input=${this.updateAddJudgeFirstname}
                        placeholder="Vorname"
                    /></label>
                  </td>
                  <td>
                    <label
                      ><span>Nachname</span
                      ><input
                        type="text"
                        .value=${this.addJudge.lastname}
                        @input=${this.updateAddJudgeLastname}
                        placeholder="Nachname"
                    /></label>
                  </td>
                  <td>
                    <label
                      ><span>Email</span
                      ><input
                        type="text"
                        .value=${this.addJudge.mail}
                        @input=${this.updateAddJudgeMail}
                        placeholder="hallo@example.com"
                    /></label>
                  </td>
                  <td>
                    <label
                      ><span>Geburtstag</span
                      ><input
                        type="date"
                        .value=${this.addJudge.birthdate
                          .toISOString()
                          .slice(0, 10)}
                        @input=${this.updateAddJudgeBirthdate}
                    /></label>
                  </td>
                  ${repeat(
                    ALL_CATEGORIES,
                    (x) => x,
                    (category) => {
                      const [cup, part, group] = category.split("_");
                      let readableName = "";
                      if (cup == "n") {
                        readableName = "Nachwuchs";
                      } else if (cup == "s") {
                        readableName = "Sonderpokal";
                      }
                      if (part == "ew") {
                        readableName += " Einzel W";
                      } else if (part == "em") {
                        readableName += " Einzel M";
                      } else if (part == "p") {
                        readableName += " Paar";
                      } else {
                        readableName += " Einzel";
                      }
                      if (group == "u15") {
                        readableName += " U15";
                      } else {
                        readableName += " 15+";
                      }
                      return html`<td class="juryselect">
                        <h6>${readableName}</h6>
                        ${repeat(
                          ALL_JUDGE_PARTS,
                          (x) => x,
                          (type) => {
                            const isJudge = (this.addJudge as any)[
                              category + "_" + type
                            ];
                            const isHosp = (this.addJudge as any)[
                              category + "_" + type + "_hosp"
                            ];
                            return html` <label
                              ><span class="type-label"
                                >${type.toUpperCase()}</span
                              ><select
                                @input=${(e: InputEvent) =>
                                  this.updateAddJudgeCategory(
                                    e,
                                    category + "_" + type
                                  )}
                              >
                                <option value="judge" ?selected=${isJudge}>
                                  ✔️
                                </option>
                                <option value="hosp" ?selected=${isHosp}>
                                  👀
                                </option>
                                <option
                                  value="none"
                                  ?selected=${!isJudge && !isHosp}
                                >
                                  -
                                </option>
                              </select></label
                            >`;
                          }
                        )}
                      </td>`;
                    }
                  )}
                  <td class="actionCol">
                    <button
                      class="green material-icon"
                      @click=${this.commitAddJudge}
                    >
                      save
                    </button>
                    <button
                      class="red material-icon"
                      @click=${this.resetAddJudge}
                    >
                      cancel
                    </button>
                  </td>
                </tr>`
              : html`<tr id="addJudgeRow">
                  <td colspan="64">
                    <button
                      id="addJudgeButton"
                      class="material-icon"
                      @click=${() => (this.addJudgeMode = true)}
                    >
                      add
                    </button>
                  </td>
                </tr>`
            : nothing}
          ${this.judges.render({
            complete: (judges) =>
              judges.map((judge) => {
                const editJudge = this.judgeEdits.get(judge.id);
                return editJudge
                  ? html`<tr>
                      <td>
                        <label
                          ><span>Vorname</span
                          ><input
                            type="text"
                            .value=${editJudge.firstname}
                            @input=${(e: InputEvent) =>
                              this.updateEditJudgeFirstname(editJudge, e)}
                            placeholder="Vorname"
                        /></label>
                      </td>
                      <td>
                        <label
                          ><span>Nachname</span
                          ><input
                            type="text"
                            .value=${editJudge.lastname}
                            @input=${(e: InputEvent) =>
                              this.updateEditJudgeLastname(editJudge, e)}
                            placeholder="Nachname"
                        /></label>
                      </td>
                      <td>
                        <label
                          ><span>Email</span
                          ><input
                            type="text"
                            .value=${editJudge.mail}
                            @input=${(e: InputEvent) =>
                              this.updateEditJudgeMail(editJudge, e)}
                            placeholder="hallo@example.com"
                        /></label>
                      </td>
                      <td>
                        <label
                          ><span>Geburtstag</span
                          ><input
                            type="date"
                            .value=${editJudge.birthdate
                              .toISOString()
                              .slice(0, 10)}
                            @input=${(e: InputEvent) =>
                              this.updateEditJudgeBirthdate(editJudge, e)}
                        /></label>
                      </td>
                      ${repeat(
                        ALL_CATEGORIES,
                        (x) => x,
                        (category) => {
                          const [cup, part, group] = category.split("_");
                          let readableName = "";
                          if (cup == "n") {
                            readableName = "Nachwuchs";
                          } else if (cup == "s") {
                            readableName = "Sonderpokal";
                          }
                          if (part == "ew") {
                            readableName += " Einzel W";
                          } else if (part == "em") {
                            readableName += " Einzel M";
                          } else if (part == "p") {
                            readableName += " Paar";
                          } else {
                            readableName += " Einzel";
                          }
                          if (group == "u15") {
                            readableName += " U15";
                          } else {
                            readableName += " 15+";
                          }
                          return html`<td class="juryselect">
                            <h6>${readableName}</h6>
                            ${repeat(
                              ALL_JUDGE_PARTS,
                              (x) => x,
                              (type) => {
                                const isJudge = (judge as any)[
                                  category + "_" + type
                                ];
                                const isHosp = (judge as any)[
                                  category + "_" + type + "_hosp"
                                ];
                                return html` <label
                                  ><span class="type-label"
                                    >${type.toUpperCase()}</span
                                  ><select
                                    @input=${(e: InputEvent) =>
                                      this.updateEditJudgeCategory(
                                        editJudge,
                                        e,
                                        category + "_" + type
                                      )}
                                  >
                                    <option value="judge" ?selected=${isJudge}>
                                      ✔️
                                    </option>
                                    <option value="hosp" ?selected=${isHosp}>
                                      👀
                                    </option>
                                    <option
                                      value="none"
                                      ?selected=${!isJudge && !isHosp}
                                    >
                                      -
                                    </option>
                                  </select></label
                                >`;
                              }
                            )}
                          </td>`;
                        }
                      )}
                      <td class="actionCol">
                        <button
                          class="green material-icon"
                          @click=${() => this.commitJudgeEdit(editJudge)}
                        >
                          save
                        </button>
                        <button
                          class="red material-icon"
                          @click=${() => this.disableJudgeEdit(editJudge)}
                        >
                          cancel
                        </button>
                      </td>
                    </tr>`
                  : html`<tr>
                      <td>
                        <label><span>Vorname</span></label> ${judge.firstname}
                      </td>
                      <td>
                        <label><span>Nachname</span></label> ${judge.lastname}
                      </td>
                      <td>
                        <label><span>Mail</span></label> ${judge.mail}
                      </td>
                      <td>
                        <label><span>Geburtstag</span></label>
                        ${judge.birthdate.toLocaleDateString()}
                      </td>
                      ${repeat(
                        ALL_CATEGORIES,
                        (x) => x,
                        (category) => {
                          const [cup, part, group] = category.split("_");
                          let readableName = "";
                          if (cup == "n") {
                            readableName = "Nachwuchs";
                          } else if (cup == "s") {
                            readableName = "Sonderpokal";
                          }
                          if (part == "ew") {
                            readableName += " Einzel W";
                          } else if (part == "em") {
                            readableName += " Einzel M";
                          } else if (part == "p") {
                            readableName += " Paar";
                          } else {
                            readableName += " Einzel";
                          }
                          if (group == "u15") {
                            readableName += " U15";
                          } else {
                            readableName += " 15+";
                          }
                          return html`<td class="juryselect">
                            <h6>${readableName}</h6>
                            ${repeat(
                              ALL_JUDGE_PARTS,
                              (x) => x,
                              (type) => {
                                const isJudge = (judge as any)[
                                  category + "_" + type
                                ];
                                const isHosp = (judge as any)[
                                  category + "_" + type + "_hosp"
                                ];
                                return html`<div class="type">
                                  <span class="type-label"
                                    >${type.toUpperCase()}</span
                                  >${isJudge ? "✔️" : isHosp ? "👀" : "-"}
                                </div>`;
                              }
                            )}
                          </td>`;
                        }
                      )}
                      <td class="actionCol">
                        ${this.systemStatus?.can_register_judge
                          ? html` <button
                                @click=${() => this.enableJudgeEdit(judge)}
                                class="blue material-icon"
                              >
                                edit
                              </button>
                              <button
                                @click=${() => this.deleteJudge(judge)}
                                class="red material-icon"
                              >
                                delete
                              </button>`
                          : nothing}
                      </td>
                    </tr>`;
              }),
            error: (error) => html`<p>${error}</p>`,
            pending: () => html`<p>Lädt Judge...</p>`,
          })}
        </tbody>
      </table> `;
  }

  enableJudgeEdit(judge: Judge) {
    this.judgeEdits.set(judge.id, { ...judge });
    this.requestUpdate();
  }

  disableJudgeEdit(judge: Judge) {
    this.judgeEdits.delete(judge.id);
    this.requestUpdate();
  }

  async commitJudgeEdit(judge: Judge) {
    if (!validateJudge(judge)) {
      return;
    }

    console.log(judge);

    let resp = await client.POST("/api/command/edit_club_judge", {
      body: {
        ...judge,
        judge_id: judge.id,
        birthdate: judge.birthdate.toISOString(),
      },
    });
    if (resp.error) {
      alert("Fehler beim Speichern: " + resp.error);
      return;
    }
    this.judgeEdits.delete(judge.id);
    this.judges.run();
  }

  async deleteJudge(judge: Judge) {
    if (
      !confirm(
        `Sicher, dass du ${judge.firstname} ${judge.lastname} löschen willst? Gib 'Ja' ein:`
      )
    ) {
      return;
    }
    let resp = await client.POST("/api/command/delete_club_judge", {
      body: { judge_id: judge.id },
    });
    if (resp.error) {
      alert("Fehler beim Löschen: " + resp.error);
      return;
    }
    this.judgeEdits.delete(judge.id);
    this.judges.run();
  }

  updateEditJudgeFirstname(judge: Judge, e: InputEvent) {
    judge.firstname = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateEditJudgeLastname(judge: Judge, e: InputEvent) {
    judge.lastname = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateEditJudgeMail(judge: Judge, e: InputEvent) {
    judge.mail = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateEditJudgeBirthdate(judge: Judge, e: InputEvent) {
    judge.birthdate = new Date((e.target as HTMLInputElement).value);
    this.requestUpdate();
  }

  updateEditJudgeCategory(judge: Judge, e: InputEvent, category: string) {
    (judge as any)[category] = (e.target as HTMLSelectElement).value == "judge";
    (judge as any)[category + "_hosp"] =
      (e.target as HTMLSelectElement).value == "hosp";
    this.requestUpdate();
  }

  updateAddJudgeFirstname(e: InputEvent) {
    this.addJudge.firstname = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateAddJudgeLastname(e: InputEvent) {
    this.addJudge.lastname = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateAddJudgeMail(e: InputEvent) {
    this.addJudge.mail = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateAddJudgeBirthdate(e: InputEvent) {
    this.addJudge.birthdate = new Date((e.target as HTMLInputElement).value);
    this.requestUpdate();
  }

  updateAddJudgeCategory(e: InputEvent, category: string) {
    (this.addJudge as any)[category] =
      (e.target as HTMLSelectElement).value == "judge";
    (this.addJudge as any)[category + "_hosp"] =
      (e.target as HTMLSelectElement).value == "hosp";
    this.requestUpdate();
  }

  async commitAddJudge() {
    if (!this.club || !validateJudge(this.addJudge)) {
      return;
    }

    let resp = await client.POST("/api/command/add_club_judge", {
      body: {
        ...this.addJudge,
        club_id: this.club?.id,
        birthdate: this.addJudge.birthdate.toISOString(),
      },
    });

    if (resp.error) {
      alert("Fehler beim Speichern: " + resp.error);
      return;
    }
    this.judges.run();
    this.resetAddJudge();
  }

  resetAddJudge() {
    this.addJudge = {
      firstname: "",
      lastname: "",
      mail: "",
      birthdate: new Date(),
      n_em_u15_p: false,
      n_em_u15_p_hosp: false,
      n_em_u15_t: false,
      n_em_u15_t_hosp: false,
      n_em_u15_a: false,
      n_em_u15_a_hosp: false,
      n_em_o15_p: false,
      n_em_o15_p_hosp: false,
      n_em_o15_t: false,
      n_em_o15_t_hosp: false,
      n_em_o15_a: false,
      n_em_o15_a_hosp: false,
      n_ew_u15_p: false,
      n_ew_u15_p_hosp: false,
      n_ew_u15_t: false,
      n_ew_u15_t_hosp: false,
      n_ew_u15_a: false,
      n_ew_u15_a_hosp: false,
      n_ew_o15_p: false,
      n_ew_o15_p_hosp: false,
      n_ew_o15_t: false,
      n_ew_o15_t_hosp: false,
      n_ew_o15_a: false,
      n_ew_o15_a_hosp: false,
      n_p_u15_p: false,
      n_p_u15_p_hosp: false,
      n_p_u15_t: false,
      n_p_u15_t_hosp: false,
      n_p_u15_a: false,
      n_p_u15_a_hosp: false,
      n_p_o15_p: false,
      n_p_o15_p_hosp: false,
      n_p_o15_t: false,
      n_p_o15_t_hosp: false,
      n_p_o15_a: false,
      n_p_o15_a_hosp: false,
      s_e_u15_p: false,
      s_e_u15_p_hosp: false,
      s_e_u15_t: false,
      s_e_u15_t_hosp: false,
      s_e_u15_a: false,
      s_e_u15_a_hosp: false,
      s_e_o15_p: false,
      s_e_o15_p_hosp: false,
      s_e_o15_t: false,
      s_e_o15_t_hosp: false,
      s_e_o15_a: false,
      s_e_o15_a_hosp: false,
      s_p_u15_p: false,
      s_p_u15_p_hosp: false,
      s_p_u15_t: false,
      s_p_u15_t_hosp: false,
      s_p_u15_a: false,
      s_p_u15_a_hosp: false,
      s_p_o15_p: false,
      s_p_o15_p_hosp: false,
      s_p_o15_t: false,
      s_p_o15_t_hosp: false,
      s_p_o15_a: false,
      s_p_o15_a_hosp: false,
    };
    this.addJudgeMode = false;
  }
}

const validateJudge = (judge: MaybeNewJudge) => {
  if (!judge.firstname) {
    alert("Vorname fehlt");
    return false;
  }
  if (!judge.lastname) {
    alert("Nachname fehlt");
    return false;
  }
  if (!judge.birthdate) {
    alert("Geburtstag fehlt");
    return false;
  }
  if (!judge.mail || !judge.mail.includes("@")) {
    alert("Mail fehlt oder ist ungültig");
    return false;
  }
  return true;
};
