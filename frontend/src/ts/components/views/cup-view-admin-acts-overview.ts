import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";
import { repeat } from "lit/directives/repeat.js";

@customElement("cup-view-admin-acts-overview")
export default class CupViewAdminActsOverview extends LitElement {
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
    }

    td,
    th {
      padding: 0.5rem;
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
  `;

  clubs = new Task(this, {
    task: async () => {
      const users = (await client.GET("/api/query/list_users")).data?.filter(
        (user) => user.club_id
      );
      if (!users) {
        throw new Error("Unable to load users");
      }

      const clubs = [];

      for (const user of users) {
        const club = await (
          await client.GET("/api/query/get_club", {
            params: { query: { club_id: user.club_id } },
          })
        ).data!;
        const acts =
          (
            await client.GET("/api/query/list_club_acts", {
              params: { query: { club_id: club.id } },
            })
          ).data || [];

        clubs.push({
          club,
          user,
          acts,
          actsReady: acts.reduce(
            (a, act) => a + (act.song_file && act.name ? 1 : 0),
            0
          ),
          actsWithSong: acts.reduce((a, act) => a + (act.song_file ? 1 : 0), 0),
          actsWithName: acts.reduce((a, act) => a + (act.name ? 1 : 0), 0),
        });
      }
      console.log(clubs);
      return clubs;
    },
    args: () => [],
  });

  allActs = new Task(this, {
    args: () => [],
    task: async () => {
      const acts = await client.GET("/api/query/list_acts");
      return acts.data || [];
    },
  });
  categories = new Task(this, {
    args: () => [],
    task: async () => {
      const data = await client.GET("/api/query/list_categories");
      if (data.error) {
        throw new Error((data.error as { message: string }).message);
      }
      return data.data;
    },
  });
  acts = new Task(this, {
    task: async ([categories]) => {
      if (!categories) return [];
      const data = await client.GET("/api/query/list_acts");
      if (data.error) {
        throw new Error((data.error as { message: string }).message);
      }
      const acts = data.data;

      const actsByCategory: { [type: string]: components["schemas"]["Act"][] } =
        {};
      for (const category of categories) {
        actsByCategory[category.name] = acts.filter(
          (act) => act.category === category.name
        );
      }
      return actsByCategory;
    },
    args: () => [this.categories.value],
  });

  override render() {
    return html`<nav>
        <a href="/admin">Anmeldeübersicht</a>
      </nav>
      ${this.allActs.render({
        loading: () => html`Loading...`,
        error: (error) => html`Error: ${error}`,
        complete: (acts) => html`
          <table>
            <tbody>
              <tr>
                <th>Erwartet</th>
                <td class="right">${acts.length}</td>
              </tr>
              <tr>
                <th>Songs Fertig</th>
                <td class="right">
                  ${acts.reduce((a, c) => a + (c.song_file ? 1 : 0), 0)}
                </td>
              </tr>
              <tr>
                <th>Songs Fehlen</th>
                <td class="right">
                  ${acts.reduce((a, c) => a + (c.song_file ? 0 : 1), 0)}
                </td>
              </tr>
            </tbody>
          </table>
        `,
      })}
      ${this.clubs.render({
        loading: () => html`Loading...`,
        error: (error) => html`Error: ${error}`,
        complete: (clubs) => html`
          <table>
            <thead>
              <tr>
                <th>Verein</th>
                <th>Nutzer</th>
                <th>Kontakt</th>
                <th>Küren</th>
                <th>Musik</th>
                <th>Namen</th>
                <th>Fertig</th>
              </tr>
            </thead>
            <tbody>
              ${repeat(
                clubs,
                (c) => c.club.id,
                (c) => html`<tr>
                  <td>${c.club.name}</td>
                  <td>${c.user.name}</td>
                  <td>${c.user.email}</td>
                  <td class="right">${c.acts.length}</td>
                  <td class="right">${c.actsWithSong}</td>
                  <td class="right">${c.actsWithName}</td>
                  <td class="right">${c.actsReady}</td>
                  <td>
                    ${c.actsReady == c.acts.length
                      ? "✔️"
                      : c.actsReady
                      ? "⌛"
                      : "❌"}
                  </td>
                </tr>`
              )}
            </tbody>
          </table>
        `,
      })}
      <hr>
      ${this.acts.render({
        complete: (actsByCategory) => html`
          ${Object.entries(actsByCategory).map(
            ([category, acts]) => html`
              <section class="category">
                <h3>${category}</h3>
                <table>
                  ${acts.map(
                    (act) => html`
                      <tr>
                        <td>${act.name}</td>
                        <td>
                          ${act.participants
                            .map((p) => p.firstname + " " + p.lastname)
                            .join(" & ")}
                        </td>
                        <td>${act.song_file ? "✔️" : "❌"}</td>
                      </tr>
                    `
                  )}
                </table>
              </section>
            `
          )}
        `,
      })}`;
  }
}
