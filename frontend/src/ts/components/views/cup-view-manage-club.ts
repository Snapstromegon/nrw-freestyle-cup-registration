import { LitElement, html, css } from "lit";
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
      return resp.data.starters;
    },
    args: () => [this.club.value?.id],
  });

  override render() {
    return html`
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
                  ${starter.firstname} ${starter.lastname}
                  <button>Löschen</button>
                </li>`
            )}
          </ul>`,
        pending: () => html`<p>Starter werden geladen...</p>`,
        error: (error) => html`<p>${error}</p>`,
      })}
    `;
  }
}
