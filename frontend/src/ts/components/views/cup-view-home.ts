import { consume } from "@lit/context";
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { User, userContext } from "../../contexts/user";
import { client } from "../../apiClient";

@customElement("cup-view-home")
export default class CupViewHome extends LitElement {
  @consume({ context: userContext, subscribe: true })
  user: User | null = null;
  @state() message: string = "Hello, World!";

  override render() {
    return html`<h1>Hi ${this.user?.name}</h1>
      ${this.user?.is_admin
        ? html`<p>Du bist Admin! <a href="/admin">Admininterface</a></p>`
        : nothing}
      <button @click=${this.logout}>Logout</button>`;
  }

  async logout() {
    await client.POST("/api/command/logout");
    window.location.href = "/";
    this.dispatchEvent(new Event("logout", { bubbles: true, composed: true }));
  }
}
