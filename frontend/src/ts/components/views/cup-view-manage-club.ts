import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { client } from "../../apiClient";
import { consume } from "@lit/context";
import { User, userContext } from "../../contexts/user";
import { Task } from "@lit/task";

@customElement("cup-view-manage-club")
export default class CupViewManageClub extends LitElement {
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

    section {
      width: 20rem;
      border: 0.1rem solid #000;
      border-radius: 0.5rem;
      padding: 1rem;

      & form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;

        & label {
          display: flex;
          flex-direction: column;
          gap: 0.1rem;

          & input[type="checkbox"] {
            align-self: flex-start;
          }
        }
      }
    }

    input,
    button {
      padding: 0.25rem;
    }

    button {
      background: #009036;
      color: #fff;
      border: none;
      border-radius: 0.5rem;
      cursor: pointer;
    }

    input[type="checkbox"] {
      appearance: none;
      display: block;
      width: 2rem;
      height: 1rem;
      border-radius: 100vmax;
      background: #444;
      position: relative;
      overflow: hidden;
      contain: content;
      padding: 0;

      &::before {
        content: "";
        display: block;
        width: 100%;
        height: 100%;
        background: #0a0;
        transform: translateX(calc(-100% + 0.5rem));
        transition: transform 0.2s;
        position: absolute;
      }

      &:after {
        content: "";
        position: absolute;
        display: block;
        aspect-ratio: 1;
        height: 100%;
        background: #aaa;
        border-radius: 100vmax;
        transition: transform 0.2s;
      }

      &:checked {
        &::before {
          transform: translateX(0);
        }

        &:after {
          transform: translateX(1rem);
        }
      }
    }

    section ul {
      padding-left: 2rem;
    }

    .delete {
      background: #e2001a;
      color: #fff;
    }
  `;
  @state() error?: string = undefined;
  @consume({ context: userContext, subscribe: true })
  user: User | null = null;

  club = new Task(this, {
    task: async ([clubId]) => {
      if (!clubId) {
        return null;
      }
      let resp = await client.GET("/api/query/get_club", {
        searchParams: { id: clubId },
      });
      if (resp.error) {
        throw new Error((resp.error as any).message);
      }
      if (!resp.data) {
        throw new Error("Club not found");
      }
      return resp.data;
    },
    args: () => [new URL(window.location.href).searchParams.get("club")],
  });

  starters = new Task(this, {
    task: async ([clubId]) => {
      if (!clubId) {
        return [];
      }
      let resp = await client.GET("/api/query/list_club_starters", {
        params: { query: { club_id: clubId } },
      });
      if (resp.error) {
        throw new Error((resp.error as any).message);
      }
      return resp.data.starters.map((starter) => {
        const birthdate = new Date(starter.birthdate);
        return { ...starter, birthdate };
      });
    },
    args: () => [this.club.value?.id],
  });

  override render() {
    return html`
      <aside><a href="/">Zurück zum Start</a></aside>
      <h1>
        Manage Club
        ${this.club.render({ complete: (club) => html`${club!.name}` })}
      </h1>

      <h2>Starter</h2>
      ${this.starters.render({
        complete: (starters) =>
          html`<ul>
            ${starters.map(
              (starter) =>
                html`<li>
                  <section>
                    <h3>${starter.firstname} ${starter.lastname}</h3>
                    <p>
                      ${starter.birthdate
                        .getUTCDate()
                        .toString()
                        .padStart(2, "0")}.${(
                        starter.birthdate.getUTCMonth() + 1
                      )
                        .toString()
                        .padStart(2, "0")}.${starter.birthdate.getUTCFullYear()}
                    </p>
                    <p>
                      ${starter.sonderpokal ? "Sonderpokal" : "Nachwuchscup"}
                    </p>
                    <ul>
                      ${starter.single_male
                        ? html`<li>Einzel Männlich</li>`
                        : nothing}
                      ${starter.single_female
                        ? html`<li>Einzel Weiblich</li>`
                        : nothing}
                      ${starter.pair
                        ? html`<li>Paar mit ${starter.partner_name}</li>`
                        : nothing}
                    </ul>
                    <button
                      class="delete"
                      @click=${() => this.deleteStarter(starter)}
                    >
                      Löschen
                    </button>
                  </section>
                </li>`
            )}
          </ul>`,
        pending: () => html`<p>Starter werden geladen...</p>`,
        error: (error) => html`<p>${error}</p>`,
      })}

      <section>
        <h3>Neuer Starter</h3>
        <form @submit=${this.addClubStarter}>
          <label for="firstname"
            >Vorname
            <input
              type="text"
              id="firstname"
              name="firstname"
              placeholder="Vorname"
              required
          /></label>
          <label for="lastname"
            >Nachname
            <input
              type="text"
              id="lastname"
              name="lastname"
              placeholder="Nachname"
              required
          /></label>
          <label for="birthday"
            >Geburtstag
            <input
              type="date"
              id="birthday"
              name="birthday"
              placeholder="Geburtstag"
              required
          /></label>
          <label for="sonderpokal"
            >Kategorie
            <select id="sonderpokal" name="sonderpokal">
              <option value="false">Nachwuchscup</option>
              <option value="true">Sonderpokal</option>
            </select>
          </label>
          <label for="single_male"
            >Einzel Männlich
            <input type="checkbox" id="single_male" name="single_male"
          /></label>
          <label for="single_female"
            >Einzel Weiblich
            <input type="checkbox" id="single_female" name="single_female"
          /></label>
          <label for="pair"
            >Paar <input type="checkbox" id="pair" name="pair"
          /></label>
          <label for="partner_name"
            >Partner Name
            <input
              type="text"
              id="partner_name"
              name="partner_name"
              placeholder="Partner Name"
          /></label>

          <button type="submit">Hinzufügen</button>
        </form>
      </section>
    `;
  }

  async addClubStarter(event: SubmitEvent) {
    event.preventDefault();
    if (!this.club.value) {
      return;
    }
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const response = await client.POST("/api/command/add_club_starter", {
      body: {
        club_id: this.club.value?.id,
        firstname: formData.get("firstname") as string,
        lastname: formData.get("lastname") as string,
        birthdate: new Date(formData.get("birthday") as string).toISOString(),
        sonderpokal: formData.get("sonderpokal") === "true",
        single_male: formData.get("single_male") === "on",
        single_female: formData.get("single_female") === "on",
        pair: formData.get("pair") === "on",
        partner_name: formData.get("partner_name") as string,
      },
    });
    if (response.error) {
      this.error = "Starter konnte nicht hinzugefügt werden.";
      return;
    }
    this.starters.run();
  }

  async deleteStarter(starter: any) {
    const response = await client.POST("/api/command/delete_club_starter", {
      body: { starter_id: starter.id },
    });
    if (response.error) {
      this.error = "Starter konnte nicht gelöscht werden.";
      return;
    }
    this.starters.run();
  }
}
