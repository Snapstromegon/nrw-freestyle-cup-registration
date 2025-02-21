import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { User } from "../../contexts/user";
import { client, components } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";

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

    nav a {
      padding: .5rem;
      display: inline-block;
    }
  `;

  users = new Task(this, {
    task: async () => {
      const data = await client.GET("/api/query/list_users");
      if (data.error) {
        throw new Error((data.error as { message: string }).message);
      }
      const users = data.data as (User & {
        club?: components["schemas"]["Club"];
        starters?: components["schemas"]["ClubStarter"][];
        judges?: components["schemas"]["ClubJudge"][];
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
          const judges = await client.GET(`/api/query/list_club_judges`, {
            params: {
              query: {
                club_id: user.club_id!,
              },
            },
          });
          user.club = club.data;
          user.starters = starters.data;
          user.judges = judges.data;
        }
      }
      return users;
    },
    args: () => [],
  });

  override render() {
    return html`
      <nav>
        <a href="/admin-starters">Starter Tabellen</a>
        <a href="/admin-payments">Zahlungsmanager</a>
        <a href="/admin-acts-overview">Küren Übersicht</a>
        <a href="/admin-judges">Judges Übersicht</a>
      </nav>
      <h2>Users</h2>
      ${this.users.render({
        complete: (data) =>
          html` ${data?.map(
            (user) => html`<div>
              <h3>${user.name}</h3>
              <p>${user.email}</p>
              <p>${user.email_verified ? "✔️" : "❌"}</p>
              <p>${user.is_admin ? "✔️" : "❌"}</p>
              ${user.club_id
                ? html` <cup-context-club clubId=${user.club_id}>
                    <cup-club-manager ?adminMode=${true}></cup-club-manager>
                  </cup-context-club>`
                : html`<p>Kein Verein</p>`}
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
