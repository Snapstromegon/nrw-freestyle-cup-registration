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
        padding: 0.5rem;
        border-bottom: 1px solid #888;
        &.category-header {
          position: sticky;
          top: 0;
          background: #ddd;
        }
      }
    }
  `;

  @property({ attribute: false }) timeplan?:
    | components["schemas"]["Timeplan"]
    | null = null;
  @property({ attribute: "include-past", type: Boolean }) includePast = false;

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
            (this.includePast
              ? this.timeplan?.items
              : this.timeplan?.items.filter(
                  (item) => item.status != "Ended"
                )) || [],
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
                      <input
                        type="checkbox"
                        ?checked=${acts
                          ?.filter(
                            (completeAct) =>
                              "Category" in item.timeplan_entry &&
                              completeAct.category ==
                                item.timeplan_entry.Category.name
                          )
                          ?.every((a) => a.song_checked)}
                        disabled
                      />
                    </section>
                    ${repeat(
                      this.includePast
                        ? item.timeplan_entry.Category.acts
                        : item.timeplan_entry.Category.acts.filter(
                            (a) => a.status != "Ended"
                          ),
                      (act) => act.id,
                      (act) => html`
                        <section>
                          <h3>
                            ${repeat(
                              acts?.find(
                                (completeAct) => completeAct.id == act.id
                              )?.participants || [],
                              (p) =>
                                `${p.firstname} ${p.lastname} (${p.club_name})`
                            )}
                          </h3>
                          <h4>${act.name}</h4>
                          <p class="time">${niceTime(act.predicted_start)}</p>
                          <input
                            type="checkbox"
                            ?checked=${acts?.find(
                              (completeAct) => completeAct.id == act.id
                            )?.song_checked}
                            disabled
                          />
                        </section>
                      `
                    )} `
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
