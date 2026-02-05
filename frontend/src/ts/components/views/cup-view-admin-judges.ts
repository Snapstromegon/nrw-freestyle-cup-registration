import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { repeat } from "lit/directives/repeat";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";

const CATEGORY_TO_ATTRIBUTE: Record<string, string> = {
  NEM: "n_em_u15",
  NEWU11: "n_ew_u15",
  NEWU13: "n_ew_u15",
  NEWU14: "n_ew_u15",
  NEWU15: "n_ew_u15",
  "NEW15+": "n_ew_o15",
  SEU15: "s_e_u15",
  "SE15+": "s_e_o15",
  "NPU9,5": "n_p_u15",
  NPU11: "n_p_u15",
  NPU13: "n_p_u15",
  NPU15: "n_p_u15",
  "NP15+": "n_p_o15",
  SPU15: "s_p_u15",
  "SP15+": "s_p_o15",
};

@customElement("cup-view-admin-judges")
export default class CupViewAdminJudges extends LitElement {
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

    nav a {
      padding: 0.5rem;
      display: inline-block;
    }

    .category {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      align-items: flex-start;

      table {
        border: 1px solid #000;

        td {
          padding: 0.2rem;
        }
      }
    }

    h2 {
      margin-top: 2rem;
    }

    table {
      border-collapse: collapse;
      tr:hover {
        background-color: #0001;
      }
      td,
      th {
        padding: 0.2rem;
        border-right: 1px solid #0002;
        border-bottom: 1px solid #0002;
        text-align: center;
      }
      th,
      td:nth-child(1),
      td:nth-child(2),
      td:nth-child(3n) {
        border-right: 1px solid #000;
      }
    }
  `;

  categories = new Task(this, {
    task: async () => {
      const data = await client.GET("/api/query/list_categories");
      if (data.error) {
        throw new Error((data.error as { message: string }).message);
      }
      return data.data;
    },
    args: () => [],
  });

  judges = new Task(this, {
    task: async ([categories]) => {
      if (!categories) return [];
      const data = await client.GET("/api/query/list_judges");
      if (data.error) {
        throw new Error((data.error as { message: string }).message);
      }
      const all = data.data;

      const judges: {
        judge: components["schemas"]["Judge"];
        categories: Record<
          string,
          {
            technic: {
              judge: boolean;
              hospitation: boolean;
            };
            performance: {
              judge: boolean;
              hospitation: boolean;
            };
            dismounts: {
              judge: boolean;
              hospitation: boolean;
            };
          }
        >;
      }[] = [];

      for (const dataJudge of all) {
        const judge = {
          judge: dataJudge,
          categories: {},
        };
        for (const category of categories) {
          const cat = CATEGORY_TO_ATTRIBUTE[category.name];
          (judge.categories as any)[category.name] = {
            technic: {
              judge: (dataJudge as any)[cat + "_t"],
              hospitation: (dataJudge as any)[cat + "_t_hosp"],
            },
            performance: {
              judge: (dataJudge as any)[cat + "_p"],
              hospitation: (dataJudge as any)[cat + "_p_hosp"],
            },
            dismounts: {
              judge: (dataJudge as any)[cat + "_a"],
              hospitation: (dataJudge as any)[cat + "_a_hosp"],
            },
          };
        }
        judges.push(judge);
      }

      console.log(judges);
      return judges;
    },
    args: () => [this.categories.value],
  });

  override render() {
    return html`<nav>
        <a href="/admin">Anmeldeübersicht</a>
      </nav>
      <table>
        <thead>
          ${this.categories.render({
            complete: (categories) =>
              html`<tr>
                  <th rowspan="2">Club</th>
                  <th rowspan="2">Name</th>
                  <th rowspan="2">Geburtstag</th>
                  ${repeat(
                    categories,
                    (category) => html`<th colspan="3">${category.name}</th>`,
                  )}
                </tr>
                <tr>
                  ${repeat(
                    categories,
                    () =>
                      html`<th>T</th>
                        <th>P</th>
                        <th>A</th>`,
                  )}
                </tr>`,
          })}
        </thead>
        <tbody>
          ${this.judges.render({
            loading: () => html`Loading...`,
            error: (error) => html`Error: ${error}`,
            complete: (judges) => html`
              ${repeat(
                judges,
                (judge) => judge.judge.id,
                (judge) =>
                  html` <tr>
                    <td>${judge.judge.club_name}</td>
                    <td>${judge.judge.firstname} ${judge.judge.lastname}</td>
                    <td>
                      ${new Date(judge.judge.birthdate)
                        .toISOString()
                        .slice(0, 10)}
                    </td>
                    ${repeat(
                      Object.values(judge.categories),
                      (c) => c,
                      (category) => html`
                        <td>
                          ${category.technic.judge
                            ? "✔️"
                            : category.technic.hospitation
                              ? "👀"
                              : "-"}
                        </td>
                        <td>
                          ${category.performance.judge
                            ? "✔️"
                            : category.performance.hospitation
                              ? "👀"
                              : "-"}
                        </td>
                        <td>
                          ${category.dismounts.judge
                            ? "✔️"
                            : category.dismounts.hospitation
                              ? "👀"
                              : "-"}
                        </td>
                      `,
                    )}
                  </tr>`,
              )}
            `,
          })}
        </tbody>
      </table> `;
  }
}
