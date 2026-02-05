import { LitElement, html, css, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";
import { repeat } from "lit/directives/repeat.js";
import { cache } from "lit/directives/cache.js";

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

    audio {
      height: 2rem;
    }
  `;

  clubs = new Task(this, {
    task: async () => {
      const users = (await client.GET("/api/query/list_users")).data?.filter(
        (user) => user.club_id,
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
            0,
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
    task: async ([categories, acts]) => {
      if (!categories || !acts)
        return new Map<string, components["schemas"]["Act"][]>();

      const actsByCategory = new Map<string, components["schemas"]["Act"][]>();
      for (const category of categories) {
        actsByCategory.set(
          category.name,
          (acts as components["schemas"]["Act"][]).filter(
            (act) => act.category === category.name,
          ),
        );
      }
      return actsByCategory;
    },
    args: () => [this.categories.value, this.allActs.value],
  });

  override render() {
    return html`<nav>
        <a href="/admin">Anmeldeübersicht</a>
      </nav>
      <table>
        <tbody>
          <tr>
            <th>Erwartet</th>
            <td class="right">
              ${this.allActs.render({ complete: (acts) => acts.length })}
            </td>
          </tr>
          <tr>
            <th>Songs Fertig</th>
            <td class="right">
              ${this.allActs.render({
                complete: (acts) => acts.filter((a) => a.song_file).length,
              })}
            </td>
          </tr>
          <tr>
            <th>Songs Fehlen</th>
            <td class="right">
              ${this.allActs.render({
                complete: (acts) => acts.filter((a) => !a.song_file).length,
              })}
            </td>
          </tr>
        </tbody>
      </table>
      ${this.clubs.render({
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
                (c) =>
                  html`<tr>
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
                  </tr>`,
              )}
            </tbody>
          </table>
        `,
      })}
      <hr />
      ${cache(
        this.categories.render({
          complete: (categories) =>
            this.acts.render({
              complete: (actsByCategory) => html`
                ${repeat(
                  categories,
                  (category) => category.name,
                  (category) => {
                    const acts = actsByCategory.get(category.name) || [];
                    return html`
                      <section class="category">
                        <h3>${category.description}</h3>
                        <button
                          @click=${
                            // eslint-disable-next-line lit/no-template-arrow
                            () => this.shuffleOrder(acts)
                          }
                        >
                          Shuffle
                        </button>
                        <table>
                          ${repeat(
                            acts,
                            (act) => act.id,
                            (act, i) => html`
                              <tr>
                                <td>
                                  <button
                                    ?disabled=${i == 0}
                                    class="material-icon"
                                    @click=${
                                      // eslint-disable-next-line lit/no-template-arrow
                                      () => this.swapActs(act, acts[i - 1])
                                    }
                                  >
                                    arrow_upward
                                  </button>
                                  <button
                                    ?disabled=${i == acts.length - 1}
                                    class="material-icon"
                                    @click=${
                                      // eslint-disable-next-line lit/no-template-arrow
                                      () => this.swapActs(act, acts[i + 1])
                                    }
                                  >
                                    arrow_downward
                                  </button>
                                </td>
                                <td>${act.act_order || "⌛"}</td>
                                <td>${act.name}</td>
                                <td>
                                  ${act.participants
                                    .map(
                                      (p) =>
                                        `${p.firstname} ${p.lastname} (${p.club_name})`,
                                    )
                                    .join(" & ")}
                                </td>
                                <td>
                                  ${act.song_file
                                    ? html` <audio
                                        preload="none"
                                        controls
                                        src="/songs/${act.song_file}"
                                      ></audio>`
                                    : "❌"}
                                </td>
                                <td>
                                  ${act.song_file
                                    ? html`<input
                                        type="checkbox"
                                        ?checked=${act.song_checked}
                                        @change=${
                                          // eslint-disable-next-line lit/no-template-arrow
                                          (e: Event) =>
                                            this.setSongChecked(act, e)
                                        }
                                      />`
                                    : nothing}
                                </td>
                              </tr>
                            `,
                          )}
                        </table>
                      </section>
                    `;
                  },
                )}
              `,
            }),
        }),
      )}`;
  }

  async setSongChecked(act: components["schemas"]["Act"], e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    await client.POST("/api/command/set_song_checked", {
      body: { act_id: act.id, checked },
    });
    this.allActs.run();
  }

  async shuffleOrder(acts: components["schemas"]["Act"][]) {
    const shuffled = [...acts].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i++) {
      await client.POST("/api/command/set_act_order", {
        body: { act_id: shuffled[i].id, order: i + 1 },
      });
    }
    this.allActs.run();
  }

  async swapActs(
    act1: components["schemas"]["Act"],
    act2: components["schemas"]["Act"],
  ) {
    await client.POST("/api/command/set_act_order", {
      body: { act_id: act1.id, order: act2.act_order },
    });
    await client.POST("/api/command/set_act_order", {
      body: { act_id: act2.id, order: act1.act_order },
    });
    this.allActs.run();
  }
}
