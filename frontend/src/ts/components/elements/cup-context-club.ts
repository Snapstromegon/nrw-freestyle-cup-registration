import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Club, clubContext } from "../../contexts/club.js";
import { provide } from "@lit/context";
import { client } from "../../apiClient.js";
import "./cup-centered-icon-box.js";
import { Task } from "@lit/task";

@customElement("cup-context-club")
export default class CupContextClub extends LitElement {
  @provide({ context: clubContext }) club: Club | null = null;
  @property() clubId?: string;

  clubTask = new Task(this, {
    task: async ([clubId]) => {
      if (!clubId) {
        throw new Error("Vereins ID fehlt!");
      }
      const resp = await client.GET(`/api/query/get_club`, {
        params: {
          query: { club_id: clubId },
        },
      });
      if (resp.error) {
        throw new Error((resp.error as any).message);
      }
      if (!resp.data) {
        throw new Error("Verein nicht gefunden!");
      }
      this.club = resp.data;
      return resp.data;
    },
    args: () => [this.clubId],
  });

  override render() {
    return this.clubTask.render({
      complete: () => html`<slot></slot>`,
      error: (error) => html`<p>${error}</p>`,
      pending: () => html`<p>Lädt Verein...</p>`,
    });
  }
}
