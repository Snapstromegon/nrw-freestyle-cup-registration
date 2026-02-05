import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";
import { getStarterPrice } from "../elements/cup-club-starter-manager";
import { repeat } from "lit/directives/repeat.js";

@customElement("cup-view-admin-payments")
export default class CupViewAdminPayments extends LitElement {
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
        const starters = (
          await client.GET("/api/query/list_club_starters", {
            params: { query: { club_id: club.id } },
          })
        ).data?.map((s) => ({ ...s, birthdate: new Date(s.birthdate) }));

        clubs.push({
          club,
          user,
          owed: starters
            ?.map((starter) => getStarterPrice(starter))
            .reduce((acc, curr) => acc + curr, 0),
        });
      }
      return clubs;
    },
    args: () => [],
  });

  override render() {
    return html`<nav>
        <a href="/admin">Anmeldeübersicht</a>
      </nav>
      ${this.clubs.render({
        loading: () => html`Loading...`,
        error: (error) => html`Error: ${error}`,
        complete: (clubs) => html`
          <table>
            <tbody>
              <tr>
                <th>Erwartet</th>
                <td class="right">
                  ${clubs.reduce((a, c) => a + (c.owed || 0), 0)}€
                </td>
              </tr>
              <tr>
                <th>Gezahlt</th>
                <td class="right">
                  ${clubs.reduce((a, c) => a + (c.club.payment || 0), 0)}€
                </td>
              </tr>
              <tr>
                <th>Offen</th>
                <td class="right">
                  ${clubs.reduce(
                    (a, c) => a + (c.owed || 0) - (c.club.payment || 0),
                    0
                  )}€
                </td>
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>Verein</th>
                <th>Nutzer</th>
                <th>Kontakt</th>
                <th>Summe</th>
                <th>Gezahlt</th>
                <th></th>
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
                  <td class="right">${c.owed}€</td>
                  <td class="right">${c.club.payment || 0}€</td>
                  <td>
                    <button
                      class="material-icon"
                      @click=${
                        // eslint-disable-next-line lit/no-template-arrow
                        () => this.updatePayment(c.club)
                      }
                    >
                      payments
                    </button>
                  </td>
                </tr>`
              )}
            </tbody>
          </table>
        `,
      })}`;
  }

  async updatePayment(club: components["schemas"]["Club"]) {
    const amount = parseFloat(
      prompt("Betrag in Euro:")?.replace(",", ".") || ""
    );
    if (!amount && amount !== 0) {
      alert("Ungültiger Betrag.");
      return;
    }
    const resp = await client.POST("/api/command/set_payment", {
      body: { club_id: club.id, amount },
    });
    if (resp.error) {
      alert("Fehler beim Speichern: " + resp.error);
      return;
    }
    console.log(resp);
    alert(`Zahlung von ${amount}€ eingetragen.`);
    club.payment = amount;
    document.location.reload();
  }
}
