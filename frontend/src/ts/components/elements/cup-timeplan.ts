import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { components } from "../../bindings";
import { repeat } from "lit/directives/repeat.js";
import { Task } from "@lit/task";
import { client } from "../../apiClient";

@customElement("cup-timeplan")
export default class CupTimeplan extends LitElement {
  static override styles = css`
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    #wrapper {
      display: flex;
      flex-direction: column;
      max-height: 100%;
      position: relative;
      overflow: auto;

      & > section {
        background: #fff;
        &.category-header {
          position: sticky;
          top: 0;
        }
      }
    }
  `;

  @property({ attribute: false }) timeplan?:
    | components["schemas"]["Timeplan"]
    | null = null;
  @property({ attribute: false }) includePast: boolean = false;

  allActs = new Task(this, {
    task: async () => (await client.GET("/api/query/list_acts")).data,
    args: () => [],
  });

  override render() {
    console.log(this.allActs, this.timeplan);
    return html`<div id="wrapper">
      ${this.allActs.render({
        loading: () => html`Loading...`,
        error: (error) => html`Error: ${error}`,
        complete: (acts) =>
          repeat(
            this.timeplan?.items || [],
            (item) =>
              "Category" in item.timeplan_entry
                ? item.timeplan_entry.Category.name
                : item.timeplan_entry.Custom.label,
            (item) =>
              "Category" in item.timeplan_entry
                ? html`<section class="category-header">
                    <h3 class="title">
                      ${item.timeplan_entry.Category.description}
                    </h3>
                    <p class="time">${niceTime(item.predicted_start)}</p>
                  </section>`
                : html`
                    <section>
                      <h3 class="title">${item.timeplan_entry.Custom.label}</h3>
                      <p class="time">${niceTime(item.predicted_start)}</p>
                    </section>
                  `
          ),
      })}
    </div>`;
  }
}

const niceTime = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
};
