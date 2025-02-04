import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { consume } from "@lit/context";
import { Task } from "@lit/task";
import { Club, clubContext } from "../../contexts/club";
import { SystemStatus, systemStatusContext } from "../../contexts/systemStatus";
import { User, userContext } from "../../contexts/user";

type Act = components["schemas"]["ClubAct"];

@customElement("cup-club-act-manager")
export default class CupClubActManager extends LitElement {
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

    li {
      list-style: inside;
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

    #addActButton {
      width: 100%;
      height: 100%;
      border-radius: 0;
    }

    audio {
      max-width: 100%;
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
      #addActRow,
      .actionCol {
        display: none;
      }
    }
  `;

  @consume({ context: clubContext, subscribe: true }) club: Club | null = null;

  @consume({ context: systemStatusContext, subscribe: true })
  systemStatus: SystemStatus | null = null;
  @consume({ context: userContext, subscribe: true }) user: User | null = null;

  @property({ type: Boolean }) adminMode = false;

  acts = new Task(this, {
    task: async ([clubId]) => {
      if (!clubId) {
        return [];
      }
      let resp = await client.GET("/api/query/list_club_acts", {
        params: { query: { club_id: clubId } },
      });
      if (resp.error) {
        throw new Error((resp.error as any).message);
      }
      return resp.data;
    },
    args: () => [this.club?.id],
  });

  @state() actEdits: Map<string, Act> = new Map();

  override render() {
    return html`<h4>Küren</h4>
      ${this.adminMode
        ? nothing
        : html` <p>
            Änderungen können noch bis zum Musik Einsendeschluss am
            <strong>02.03.2025</strong> vorgenommen werden.
          </p>`}
      <h5>Zusammenfassung</h5>
      <table id="summary">
        <tr>
          <th>Küren</th>
          <td>${this.acts.value?.length}</td>
        </tr>
        <tr>
          <th>Namen vorhanden</th>
          <td>
            ${this.acts.value?.filter((act) => act.name).length}/${this.acts
              .value?.length}
            ${this.acts.value?.filter((act) => act.name).length ==
            this.acts.value?.length
              ? "✔️"
              : "⌛"}
          </td>
        </tr>
        <tr>
          <th>Beschreibung vorhanden</th>
          <td>
            ${this.acts.value?.filter((act) => act.description).length}/${this
              .acts.value?.length}
            ${this.acts.value?.filter((act) => act.description).length ==
            this.acts.value?.length
              ? "✔️"
              : "⌛"}
          </td>
        </tr>
        <tr>
          <th>Musik vorhanden</th>
          <td>
            ${this.acts.value?.filter((act) => act.song_file).length}/${this
              .acts.value?.length}
            ${this.acts.value?.filter((act) => act.song_file).length ==
            this.acts.value?.length
              ? "✔️"
              : "⌛"}
          </td>
        </tr>
      </table>

      <h5>Act</h5>
      <table>
        <thead>
          <tr>
            ${this.adminMode ? html`<th>ID</th>` : nothing}
            <th>Kürtitel</th>
            <th>Beschreibung</th>
            <th>Typ</th>
            <th>Kategorie</th>
            <th>Kürmusik</th>
            <th>FahrerInnen</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.acts.render({
            complete: (acts) =>
              acts.map((act) => {
                const editAct = this.actEdits.get(act.id);
                return editAct
                  ? html`<tr>
                      ${this.adminMode ? html`<td>${act.id}</td>` : nothing}
                      <td>
                        <label
                          ><span>Kürtitel</span
                          ><input
                            type="text"
                            .value=${editAct.name}
                            @input=${(e: InputEvent) =>
                              this.updateEditActName(editAct, e)}
                            placeholder="Der Titel deiner Kür"
                        /></label>
                      </td>
                      <td>
                        <label
                          ><span>Beschreibung</span
                          ><textarea
                            @input=${(e: InputEvent) =>
                              this.updateEditActDescription(editAct, e)}
                            placeholder="Hilf unserer Moderation dich perfekt einzuleiten!"
                            rows="10"
                          >
${editAct.description || ""}</textarea
                          >
                        </label>
                      </td>
                      <td>
                        <label
                          ><span>Typ</span> ${act.is_pair
                            ? "Paarkür"
                            : "Einzelkür"}</label
                        >
                      </td>
                      <td>
                        <label
                          ><span>Kategorie</span> ${act.is_sonderpokal
                            ? "Sonderpokal"
                            : "Nachwuchscup"}</label
                        >
                      </td>
                      <td>
                        Bitte lade eine MP3 Datei mit max. 10MB hoch.
                        <form
                          @submit=${(e: SubmitEvent) =>
                            this.uploadSong(editAct, e)}
                        >
                          <input type="file" accept="audio/*" />
                          <button type="submit" class="blue material-icon">
                            cloud_upload
                          </button>
                        </form>
                      </td>
                      <td>
                        <label><span>StarterInnen</span></label>
                        <ul>
                          ${editAct.participants.map(
                            (s) =>
                              html`<li>
                                ${s.starter_firstname} ${s.starter_lastname}
                              </li>`
                          )}
                        </ul>
                      </td>
                      <td class="actionCol">
                        <button
                          class="green material-icon"
                          @click=${() => this.commitActEdit(editAct)}
                        >
                          save
                        </button>
                        <button
                          class="red material-icon"
                          @click=${() => this.disableActEdit(editAct)}
                        >
                          cancel
                        </button>
                      </td>
                    </tr>`
                  : html`<tr>
                      ${this.adminMode ? html`<td>${act.id}</td>` : nothing}
                      <td>
                        <label><span>Name</span></label> ${act.name}
                      </td>
                      <td>
                        <label><span>Beschreibung</span></label>
                        ${act.description}
                      </td>
                      <td>
                        <label
                          ><span>Typ</span> ${act.is_pair
                            ? "Paarkür"
                            : "Einzelkür"}</label
                        >
                      </td>
                      <td>
                        <label><span>Kategorie</span></label
                        >${act.is_sonderpokal ? "Sonderpokal" : "Nachwuchscup"}
                      </td>
                      <td>
                        <label><span>Musik</span></label>
                        ${act.song_file
                          ? html`${act.song_file_name}<br /><audio
                                preload="none"
                                controls
                                src="/songs/${act.song_file}"
                              ></audio>`
                          : "❌"}
                      </td>
                      <td>
                        <label><span>StarterInnen</span></label>
                        <ul>
                          ${act.participants.map(
                            (s) =>
                              html`<li>
                                ${s.starter_firstname} ${s.starter_lastname}
                              </li>`
                          )}
                        </ul>
                      </td>
                      <td class="actionCol">
                        ${this.systemStatus?.can_upload_music ||
                        this.user?.is_admin
                          ? html` <button
                              @click=${() => this.enableActEdit(act)}
                              class="blue material-icon"
                            >
                              edit
                            </button>`
                          : nothing}
                      </td>
                    </tr>`;
              }),
            error: (error) => html`<p>${error}</p>`,
            pending: () => html`<p>Lädt Act...</p>`,
          })}
        </tbody>
      </table>`;
  }

  enableActEdit(act: Act) {
    this.actEdits.set(act.id, { ...act });
    this.requestUpdate();
  }

  disableActEdit(act: Act) {
    this.actEdits.delete(act.id);
    this.requestUpdate();
  }

  async commitActEdit(act: Act) {
    if (!act.name.trim()) {
      alert("Der Kürname darf nicht leer sein!");
      return;
    }
    let resp = await client.POST("/api/command/edit_club_act", {
      body: act,
    });
    if (resp.error) {
      alert(
        "Fehler beim Speichern: " + (resp.error as { message: string }).message
      );
      return;
    }
    this.actEdits.delete(act.id);
    this.acts.run();
  }

  updateEditActName(act: Act, e: InputEvent) {
    act.name = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  updateEditActDescription(act: Act, e: InputEvent) {
    act.description = (e.target as HTMLInputElement).value;
    this.requestUpdate();
  }

  async uploadSong(act: Act, e: SubmitEvent) {
    e.preventDefault();
    console.log("act", act);
    const form = e.target as HTMLFormElement;
    const file = form.querySelector("input") as HTMLInputElement;
    if (!file.files) {
      return;
    }
    const data = new FormData();
    data.append("file", file.files[0]);
    console.log(data);
    await client.POST("/api/command/save_act_song", {
      params: {
        query: { act_id: act.id },
      } as any,
      body: data as any,
    });

    alert("Musik hochgeladen!");
  }
}
