import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { SystemStatus, systemStatusContext } from "../../contexts/systemStatus.js";
import { provide } from "@lit/context";
import { client } from "../../apiClient.js";
import "./cup-centered-icon-box.js";
import { Task } from "@lit/task";

@customElement("cup-context-system-status")
export default class CupContextSystemStatus extends LitElement {
  @provide({ context: systemStatusContext }) systemStatus: SystemStatus | null = null;

  SystemStatusTask = new Task(this, {
    task: async () => {
      const resp = await client.GET(`/api/query/get_system_status`);
      if (!resp.data) {
        throw new Error("Status nicht gefunden!");
      }
      this.systemStatus = resp.data;
      return resp.data;
    },
    args: () => [],
  });

  override render() {
    return this.SystemStatusTask.render({
      complete: () => html`<slot></slot>`,
      error: (error) => html`<p>${error}</p>`,
    });
  }
}
