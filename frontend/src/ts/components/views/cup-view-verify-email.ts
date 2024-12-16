import { consume } from "@lit/context";
import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { User, userContext } from "../../contexts/user";
import { client } from "../../apiClient";
import { Task } from "@lit/task";

@customElement("cup-view-verify-email")
export default class CupViewVerifyEmail extends LitElement {
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

    main {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100dvh;
      background: #99add7;
      padding: 1rem;
    }

    #wrapper {
      display: flex;
      background: #fff;
      border-radius: 0.5rem;
      overflow: hidden;
      flex-wrap: wrap;
      place-content: center;

      & aside {
        width: 15rem;
        flex-grow: 1;
        display: flex;
        place-items: center;
        justify-content: center;
        padding: 2rem;
        background: #002d56;

        & img {
          width: 100%;
          max-width: 12rem;
          max-height: 12rem;
          height: 100%;
        }
      }
    }

    #status {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 2rem;
    }

    #error {
      border: 0.1rem solid #e2001a;
      color: #e2001a;
      padding: 0.5rem;
      border-radius: 0.5rem;
    }
  `;
  @consume({ context: userContext, subscribe: true })
  user: User | null = null;

  verificationTask = new Task(this, {
    task: async () => {
      const url = new URL(window.location.href);
      const token = url.searchParams.get("token");
      if (!token) {
        throw new Error("No token provided.");
      }
      let resp = await client.POST("/api/command/verify_email", {
        body: { token },
      });
      if (resp.response.status === 404) {
        throw new Error("Token wurde schon verwendet oder ist abgelaufen.");
      }
      if (resp.error) {
        throw new Error((resp.error as { message?: string }).message || "");
      }
      window.location.href = "/";
    },
    args: () => [],
  });

  override render() {
    return html`<main>
      <div id="wrapper">
        <aside>
          <img src="/assets/images/nrw-freestyle-cup.svg" />
        </aside>
        <div id="status">
          <h1>NRW Freestyle Cup 2025</h1>
          <h2>Email Validierung</h2>
          ${this.verificationTask.render({
            complete: () => html`<p>Email erfolgreich verifiziert!</p>`,
            pending: () => html`<p>Verifiziere Email...</p>`,
            error: () => html`<p id="error">Fehler: ${this.verificationTask.error}</p>`,
          })}
          <a href="/">Zurück zur Startseite</a>
        </div>
      </div>
    </main>`;
  }
}
