import { consume } from "@lit/context";
import { LitElement, html, nothing, css } from "lit";
import { customElement } from "lit/decorators.js";
import { User, userContext } from "../../contexts/user";
import { client, components } from "../../apiClient";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import { Task } from "@lit/task";
// import { Club } from "../../contexts/club";

@customElement("cup-view-admin")
export default class CupViewAdmin extends LitElement {
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
  `;

  @consume({ context: userContext, subscribe: true })
  user: User | null = null;

  users = new Task(this, {
    task: async () => {
      const data = await client.GET("/api/query/list_users");
      if (data.error) {
        throw new Error((data.error as { message: string }).message);
      }
      const users = data.data as (User & {
        club?: components["schemas"]["Club"];
        starters?: components["schemas"]["ClubStarter"][];
      })[];

      for (const user of users) {
        if (user.club_id !== null) {
          const club = await client.GET(`/api/query/get_club`, {
            params: {
              query: {
                club_id: user.club_id,
              },
            },
          });
          const starters = await client.GET(`/api/query/list_club_starters`, {
            params: {
              query: {
                club_id: user.club_id!,
              },
            },
          });
          user.club = club.data;
          user.starters = starters.data;
        }
      }
      return users;
    },
    args: () => [],
  });

  override render() {
    return html`
      <h2>Users</h2>
      ${this.users.render({
        complete: (data) =>
          html` ${data?.map(
            (user) => html`<div>
              <h3>${user.name}</h3>
              <p>${user.email}</p>
              <p>${user.email_verified ? "✔️" : "❌"}</p>
              <p>${user.is_admin ? "✔️" : "❌"}</p>
              ${user.club
                ? html`
                    <p>${user.club.name}</p>
                    <table>
                      <tbody>
                        ${user.starters?.map(
                          (starter) => html`
                            <tr>
                              <td>${starter.firstname}</td>
                              <td>${starter.lastname}</td>
                              <td>${starter.birthdate}</td>
                              <td>${starter.sonderpokal}</td>
                              <td>${starter.single_male}</td>
                              <td>${starter.single_female}</td>
                              <td>${starter.pair}</td>
                              <td>${starter.partner_name}</td>

                            </tr>
                          `
                        )}
                      </tbody>
                    </table>
                  `
                : nothing}
            </div>`
          )}`,
        error: (error) => html`<li>${error}</li>`,
        pending: () => html`<li>Loading...</li>`,
      })}
    `;
  }

  async logout() {
    await client.POST("/api/command/logout");
    window.location.href = "/";
    this.dispatchEvent(new Event("logout", { bubbles: true, composed: true }));
  }

  async reverifyMail() {
    const data = await client.POST("/api/command/resend_mail_validation", {
      body: {},
    });
    if (data.error) {
      console.error(data.error);
      alert("Fehler beim Versenden der Mail: " + data.error);
      return;
    }
    alert("Mail wurde versendet.");
  }
}
