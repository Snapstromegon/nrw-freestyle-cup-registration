import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";
import { repeat } from "lit/directives/repeat.js";
import { cache } from "lit/directives/cache.js";

@customElement("cup-view-startlist")
export default class CupViewStartlist extends LitElement {
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
    header {
      display: grid;
      background: #002d56;
      padding: 2rem 0;
      color: #fff;
      grid-template-columns: 1fr 2fr;
      grid-template-rows: auto auto auto;
      grid-template-areas: "img h1" "img date" "img location";
      place-items: center start;
    }

    header img {
      grid-area: img;
      width: 100%;
      min-height: 0;
      height: 7rem;
      max-height: 100%;
    }

    header h1 {
      grid-area: h1;
      font-size: 2rem;
      text-align: center;
    }

    header .date {
      grid-area: date;
      text-align: right;
    }

    header .location {
      grid-area: location;
      text-align: right;
    }

    main {
      max-width: 1800px;
      margin: 0 auto;
      padding: 2rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    h3 {
      margin-bottom: 1rem;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 3rem;
    }

    td:nth-child(1) {
      width: 10%;
    }

    td:nth-child(2) {
      width: 40%;
    }

    td:nth-child(3) {
      width: 50%;
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

  allActs = new Task(this, {
    args: () => [],
    task: async () => {
      const acts = await client.GET("/api/query/startlist");
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
    task: async ([categories, acts, predictTimeplan]): Promise<
      Map<string, { act: components["schemas"]["StartlistAct"]; tpAct: any }[]>
    > => {
      if (!categories || !acts) return new Map();

      const actsByCategory = new Map<
        string,
        { act: components["schemas"]["StartlistAct"]; tpAct: any }[]
      >();
      for (const category of categories) {
        actsByCategory.set(
          category.name,
          acts
            .filter((act) => act.category === category.name)
            .map((act) => {
              const tpEntry = predictTimeplan?.items.find((item) =>
                item.timeplan_entry && "Category" in item.timeplan_entry
                  ? item.timeplan_entry?.Category?.name == category.name
                  : undefined
              )?.timeplan_entry;
              const tpAct =
                tpEntry && "Category" in tpEntry
                  ? tpEntry.Category.acts.find((tpAct) => tpAct.id == act.id)
                  : undefined;
              return {
                act,
                tpAct,
              };
            })
        );
      }
      console.log(actsByCategory);
      return actsByCategory;
    },
    args: () =>
      [
        this.categories.value,
        this.allActs.value,
        this.predictedTimeplan.value,
      ] as [
        components["schemas"]["Category"][],
        components["schemas"]["StartlistAct"][],
        components["schemas"]["Timeplan"]
      ],
  });

  predictedTimeplan = new Task(this, {
    task: async () => {
      const res = await client.GET("/api/query/predict_timeplan");
      return res.data;
    },
    args: () => [],
  });

  override render() {
    return html`<header>
        <img src="/assets/images/nrw-freestyle-cup.svg" />
        <h1>Startliste NRW Freestyle Cup</h1>
        <span class="date">15.03. - 16.03.2025</span>
        <span class="location">SSV Nümbrecht</span>
      </header>
      <main>
        <nav>
          <a href="/">Zurück zum Anmeldetool</a>
          <a href="https://freestyle-cup.nrw/"
            >Zurück zur Veranstaltungsseite</a
          >
        </nav>
        <i
          >Alle Zeitangaben sind vorläufig und können sich am Wettkampftag nach
          vorne UND hinten verschieben.</i
        >
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
                          <table>
                            ${repeat(
                              acts,
                              (act) => act.act.id,
                              (act) => html`
                                <tr>
                                  <td>${act.act.act_order || "⌛"}</td>
                                  <td>${act.act.name}</td>
                                  <td>
                                    ${act.act.participants
                                      .map(
                                        (p) =>
                                          `${p.firstname} ${p.lastname} (${p.club_name})`
                                      )
                                      .join(" & ")}
                                  </td>
                                  <td>
                                    ${new Date(
                                      act.tpAct.predicted_start
                                    ).toLocaleTimeString(undefined, {
                                      minute: "2-digit",
                                      hour: "2-digit",
                                    })}
                                  </td>
                                </tr>
                              `
                            )}
                          </table>
                        </section>
                      `;
                    }
                  )}
                `,
              }),
          })
        )}
      </main>`;
  }
}
