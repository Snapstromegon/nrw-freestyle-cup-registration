import { LitElement, html, css, nothing } from "lit";
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
      overflow: inherit;
      background: #002d56;

      & > section {
        background: #002d56;
        color: #fff;
        padding: 1rem;
        &.category-header {
          position: sticky;
          top: 0;
          background: linear-gradient(to right, #002242 66%, #00224200);
        }
      }

      .event {
        background: linear-gradient(to right, #400 66%, #fff0);
      }
    }
  `;

  @property({ attribute: false }) timeplan?:
    | components["schemas"]["Timeplan"]
    | null = null;
  @property({ attribute: "include-past", type: Boolean }) includePast = false;
  @property({ attribute: "include-active-act", type: Boolean })
  includeActiveAct = false;
  @property({ attribute: "is-admin", type: Boolean }) isAdmin = false;

  allActs = new Task(this, {
    task: async () => (await client.GET("/api/query/list_acts")).data,
    args: () => [],
  });

  @property({type: Boolean}) description: boolean = false;

  override render() {
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
                ? item.timeplan_entry.Category.acts.filter(
                    (a) =>
                      (this.includePast || a.status != "Ended") &&
                      (this.includeActiveAct || a.status != "Started")
                  ).length
                  ? html`<section class="category-header">
                        <h3 class="title">
                          ${item.timeplan_entry.Category.description}
                        </h3>
                        ${item.started_at
                          ? nothing
                          : html`<p class="time">
                              ${niceTime(item.predicted_start)}
                            </p>`}
                        ${this.isAdmin
                          ? html`<input
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
                            />`
                          : nothing}
                      </section>
                      ${repeat(
                        item.timeplan_entry.Category.acts.filter(
                          (a) =>
                            (this.includePast || a.status != "Ended") &&
                            (this.includeActiveAct || a.status != "Started")
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
                                  html`${p.firstname} ${p.lastname}
                                    (${p.club_name})<br />`
                              )}
                            </h3>
                            <h4>${act.name}</h4>
                            <p class="time">${niceTime(act.predicted_start)}</p>
                            <p>
                              ${acts?.find(
                                (completeAct) => completeAct.id == act.id
                              )?.description}
                            </p>
                            ${this.isAdmin
                              ? html`<input
                                  type="checkbox"
                                  ?checked=${acts?.find(
                                    (completeAct) => completeAct.id == act.id
                                  )?.song_checked}
                                  disabled
                                />`
                              : nothing}
                          </section>
                        `
                      )}`
                  : nothing
                : html`
                    <section class="event">
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
