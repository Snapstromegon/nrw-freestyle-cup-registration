import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { client } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";
import { repeat } from "lit/directives/repeat.js";

@customElement("cup-view-admin-medals")
export default class CupViewAdminMedals extends LitElement {
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

    @media print {
      nav {
        display: none;
      }
    }
    @page {
      margin: 0;
      size: A4;
    }
    .page {
      display: grid;
      padding: 10.9mm 4.7mm 8mm;
      grid-template-columns: repeat(5, 1fr);
      grid-template-rows: repeat(13, 1fr);
      gap: 0 2.5mm;
      height: 100vh;
      page-break-inside: avoid;
    }
    .sticker {
      border: none;
      border-radius: 2.5mm;
      display: grid;
      place-items: center;
      font-weight: bold;
      font-size: 1rem;
      padding: 0;
      align-content: center;
      text-align: center;
      text-wrap: balance;
      /* outline: 1px solid black; */
    }
  `;

  categoryNames = new Task(this, {
    task: async () => {
      const resp = await client.GET("/api/query/list_categories");
      if (resp.error) {
        return new Map();
      }
      const data = resp.data;
      return new Map(data.map((c) => [c.name, c.description]));
    },
    args: () => [],
  });

  categories = new Task(this, {
    task: async ([categoryNames]) => {
      const resp = await client.GET("/api/query/startlist");
      if (resp.error) {
        return [];
      }
      const data = resp.data.filter((entry) => entry.category);

      const categories = new Map();
      for (const entry of data) {
        if (!categories.has(entry.category)) {
          categories.set(entry.category, {
            numberOfStarts: 0,
            numberOfMedalsPerStart: 0,
          });
        }
        const numberOfMedals = entry.participants.length;
        const category = categories.get(entry.category);
        category.numberOfStarts += 1;
        category.numberOfMedalsPerStart = Math.max(
          category.numberOfMedalsPerStart,
          numberOfMedals,
        );
      }
      return Array.from(categories.entries()).map(
        ([category, { numberOfStarts, numberOfMedalsPerStart }]) => ({
          category,
          numberOfStarts,
          numberOfMedalsPerStart,
          name: categoryNames?.get(category) || category,
        }),
      );
    },
    args: () => [this.categoryNames.value],
  });

  medals = new Task(this, {
    task: async ([categories]) => {
      if (!categories) return [];
      const medals = [];
      for (const category of categories) {
        for (let i = 0; i < Math.min(category.numberOfStarts, 3); i++) {
          for (let j = 0; j < category.numberOfMedalsPerStart; j++) {
            medals.push(category.name);
          }
        }
      }
      return medals;
    },
    args: () => [this.categories.value],
  });

  chunkedMedals = new Task(this, {
    task: async ([medals]) => {
      if (!medals) return [];
      const chunkSize = 65;
      const chunks = [];
      for (let i = 0; i < medals.length; i += chunkSize) {
        chunks.push(medals.slice(i, i + chunkSize));
      }
      return chunks;
    },
    args: () => [this.medals.value],
  });

  override render() {
    return html`<nav>
        <a href="/admin">Anmeldeübersicht</a>
        <h1>Medaillendrucker</h1>
      </nav>
      <div id="medals">
        ${this.chunkedMedals.render({
          complete: (chunks) =>
            html`<div class="page">
              ${repeat(chunks, (chunk) =>
                repeat(
                  chunk,
                  (medal) => html`<div class="sticker"><p>${medal}</p></div>`,
                ),
              )}
            </div>`,
        })}
      </div>`;
  }
}
