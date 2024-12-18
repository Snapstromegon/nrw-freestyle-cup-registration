import { consume } from "@lit/context";
import { LitElement, html, nothing, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { User, userContext } from "../../contexts/user";
import { client } from "../../apiClient";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import { Task } from "@lit/task";

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
      return data.data;
    },
    args: () => [],
  });

  override render() {
    return html`
      <h2>Users</h2>
      ${this.users.render({
        complete: (data) => html`<table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Verified</th>
              <th>Admin</th>
              <th>Club ID</th>
            </tr>
          </thead>
          <tbody>
            ${data?.map((user: any) => html`<tr>
              <td>${user.id}</td>
              <td>${user.name}</td>
              <td>${user.email}</td>
              <td>${user.email_verified ? '✔️' : '❌'}</td>
              <td>${user.is_admin ? '✔️' : '❌'}</td>
              <td>${user.club_id}</td>
            </tr>`)}
          </tbody>
        </table>`,
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
