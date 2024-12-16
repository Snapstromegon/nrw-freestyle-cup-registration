import { consume } from "@lit/context";
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { User, userContext } from "../../contexts/user";
import { client } from "../../apiClient";
import { Task } from "@lit/task";

@customElement("cup-view-home")
export default class CupViewHome extends LitElement {
  @consume({ context: userContext, subscribe: true })
  user: User | null = null;
  @state() message: string = "Hello, World!";

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
    args: () => [this.user?.club_id],
  });

  override render() {
    return html`<h1>Hi ${this.user?.name}</h1>
      ${this.user?.is_admin
        ? html`<p>Du bist Admin! <a href="/admin">Admininterface</a></p>`
        : nothing}
      <p>
        Deine Email ist ${this.user?.email}. Verifiziert:
        ${this.user?.email_verified ? "✔️" : "❌"}
      </p>
      <button @click=${this.logout}>Logout</button>

      <h2>Verein</h2>

      ${this.user?.email_verified
        ? this.user?.club_id
          ? html` ${this.club.render({
                complete: (club) => html`<p>Du bist im Verein ${club!.name}</p>`,
                pending: () => html`<p>Verein wird geladen...</p>`,
                error: (error) => html`<p>${error}</p>`,
              })}

              <a href="/manage_club?club=${this.user.club_id}"
                >Verein verwalten</a
              >`
          : html`<a href="/create_club">Verein Erstellen</a>`
        : html`<p>
            Du musst deine EMail verifizieren, um einen Verein zu erstellen.
            Falls du keine Verifizierungsmail bekommen hast, kannst du hier eine
            neue versenden:
            <button @click=${this.reverifyMail}>
              Neue Verifizierungsmail schicken
            </button>
          </p>`}`;
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
