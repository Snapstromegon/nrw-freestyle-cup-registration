import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";
import { repeat } from "lit/directives/repeat.js";

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

    #overview {
      border-collapse: collapse;
      td,
      th {
        padding: 0.2rem;
        border-right: 1px solid #000;
        text-align: center;
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

  judgesByCategory = new Task(this, {
    task: async ([categories]) => {
      if (!categories) return;
      const data = await client.GET("/api/query/list_judges");
      if (data.error) {
        throw new Error((data.error as { message: string }).message);
      }
      const all = data.data;

      interface JudgeCat {
        judge: components["schemas"]["Judge"][];
        hospitation: components["schemas"]["Judge"][];
      }

      interface CategoryJudge {
        category: components["schemas"]["Category"];
        technic: JudgeCat;
        dismounts: JudgeCat;
        performance: JudgeCat;
      }

      console.log(all);

      const judgesByCategory: Record<string, CategoryJudge> = {};

      for (const cat of categories) {
        const cat_attr = CATEGORY_TO_ATTRIBUTE[cat.name] as string;
        judgesByCategory[cat.name] = {
          category: cat,
          technic: {
            judge: all.filter((j) => (j as any)[cat_attr + "_t"] as boolean),
            hospitation: all.filter(
              (j) => (j as any)[cat_attr + "_t_hosp"] as boolean,
            ),
          },
          dismounts: {
            judge: all.filter((j) => (j as any)[cat_attr + "_a"] as boolean),
            hospitation: all.filter(
              (j) => (j as any)[cat_attr + "_a_hosp"] as boolean,
            ),
          },
          performance: {
            judge: all.filter((j) => (j as any)[cat_attr + "_p"] as boolean),
            hospitation: all.filter(
              (j) => (j as any)[cat_attr + "_p_hosp"] as boolean,
            ),
          },
        };
      }

      return judgesByCategory;
    },
    args: () => [this.categories.value],
  });

  override render() {
    return html`<nav>
        <a href="/admin">Anmeldeübersicht</a>
      </nav>
      ${this.judgesByCategory.render({
        loading: () => html`Loading...`,
        error: (error) => html`Error: ${error}`,
        complete: (judgesByCategory) => html`
          <h2>Übersicht</h2>
          <table id="overview">
            <thead>
              <tr>
                <th></th>
                ${repeat(
                  Object.values(judgesByCategory || {}),
                  (category) => category.category.name,
                  (category) =>
                    html`<th colspan="3">${category.category.name}</th>`,
                )}
              </tr>
              <tr>
                <th></th>
                ${repeat(
                  Object.values(judgesByCategory || {}),
                  () =>
                    html`<th>T</th>
                      <th>P</th>
                      <th>A</th>`,
                )}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Judge</th>
                ${repeat(
                  Object.values(judgesByCategory || {}),
                  (category) => category.category.name,
                  (category) =>
                    html`<td>${category.technic.judge.length}</td>
                      <td>${category.performance.judge.length}</td>
                      <td>${category.dismounts.judge.length}</td>`,
                )}
              </tr>
              <tr>
                <th>Hospitation</th>
                ${repeat(
                  Object.values(judgesByCategory || {}),
                  (category) => category.category.name,
                  (category) =>
                    html`<td>${category.technic.hospitation.length}</td>
                      <td>${category.performance.hospitation.length}</td>
                      <td>${category.dismounts.hospitation.length}</td>`,
                )}
              </tr>
            </tbody>
          </table>
          ${repeat(
            Object.values(judgesByCategory || {}),
            (category) => category.category.name,
            (category) => html`
              <h2>${category.category.description}</h2>
              <section class="category">
                <table>
                  <caption>
                    Technik
                  </caption>
                  <tbody>
                    ${repeat(
                      category.technic.judge,
                      (judge) => judge.id,
                      (judge) =>
                        html`<tr>
                          <td>✔️</td>
                          <td>${judge.club_name}</td>
                          <td>${judge.firstname} ${judge.lastname}</td>
                          <td>${judge.mail}</td>
                        </tr>`,
                    )}
                    ${repeat(
                      category.technic.hospitation,
                      (judge) => judge.id,
                      (judge) =>
                        html`<tr>
                          <td>👀</td>
                          <td>${judge.club_name}</td>
                          <td>${judge.firstname} ${judge.lastname}</td>
                          <td>${judge.mail}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
                <table>
                  <caption>
                    Performance
                  </caption>
                  <tbody>
                    ${repeat(
                      category.performance.judge,
                      (judge) => judge.id,
                      (judge) =>
                        html`<tr>
                          <td>✔️</td>
                          <td>${judge.club_name}</td>
                          <td>${judge.firstname} ${judge.lastname}</td>
                          <td>${judge.mail}</td>
                        </tr>`,
                    )}
                    ${repeat(
                      category.performance.hospitation,
                      (judge) => judge.id,
                      (judge) =>
                        html`<tr>
                          <td>👀</td>
                          <td>${judge.club_name}</td>
                          <td>${judge.firstname} ${judge.lastname}</td>
                          <td>${judge.mail}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
                <table>
                  <caption>
                    Abstiege
                  </caption>
                  <tbody>
                    ${repeat(
                      category.dismounts.judge,
                      (judge) => judge.id,
                      (judge) =>
                        html`<tr>
                          <td>✔️</td>
                          <td>${judge.club_name}</td>
                          <td>${judge.firstname} ${judge.lastname}</td>
                          <td>${judge.mail}</td>
                        </tr>`,
                    )}
                    ${repeat(
                      category.dismounts.hospitation,
                      (judge) => judge.id,
                      (judge) =>
                        html`<tr>
                          <td>👀</td>
                          <td>${judge.club_name}</td>
                          <td>${judge.firstname} ${judge.lastname}</td>
                          <td>${judge.mail}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </section>
            `,
          )}
        `,
      })}`;
  }
}
