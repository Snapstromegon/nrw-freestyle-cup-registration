import { provide } from "@lit/context";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { unwrap } from "../../api";
import { client } from "../../apiClient.js";
import {
  type SystemStatus,
  systemStatusContext,
} from "../../contexts/systemStatus.js";
import "./cup-centered-icon-box.js";
import { Task } from "@lit/task";

@customElement("cup-context-system-status")
export default class CupContextSystemStatus extends LitElement {
  @provide({ context: systemStatusContext }) systemStatus: SystemStatus | null =
    null;

  SystemStatusTask = new Task(this, {
    task: async () => {
      this.systemStatus = await unwrap(client.getSystemStatus());
      return this.systemStatus;
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
