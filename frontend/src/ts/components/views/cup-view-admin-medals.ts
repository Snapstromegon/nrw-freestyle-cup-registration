import { Task } from "@lit/task";
import { css, html, LitElement, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { errorMessage, unwrap } from "../../api";
import { client, type components } from "../../apiClient";
import { adminStyles } from "../../styles/admin";
import { iconStyles, resetStyles } from "../../styles/base";

/** Stickers on one A4 sheet: 5 columns × 13 rows. */
const STICKERS_PER_SHEET = 65;
/** Medals are printed for the first three places of each category. */
const PODIUM = 3;

interface MedalCategory {
  name: string;
  /** Text on the stickers: the description, or the name without one. */
  label: string;
  starts: number;
  /** Fewest and most regular riders of one start. */
  minPerStart: number;
  maxPerStart: number;
  /** Stickers to print: the riders of the three largest starts. */
  medals: number;
  /** Replacement riders in the category; they get no sticker. */
  replacements: number;
  /** Sheets (1-based) the category's stickers are printed on. */
  firstSheet: number;
  lastSheet: number;
}

const summarize = (
  categories: components["schemas"]["Category"][],
  acts: components["schemas"]["StartlistAct"][],
) => {
  const actsByCategory = new Map<string, typeof acts>();
  for (const act of acts) {
    if (act.category) {
      actsByCategory.set(act.category, [
        ...(actsByCategory.get(act.category) ?? []),
        act,
      ]);
    }
  }
  // Categories in their order; unknown ones (shouldn't happen) at the end.
  const names = [
    ...categories.map((c) => c.name),
    ...[...actsByCategory.keys()].filter(
      (name) => !categories.some((c) => c.name === name),
    ),
  ];
  const labels = new Map(categories.map((c) => [c.name, c.description]));

  let printed = 0;
  return names.map((name): MedalCategory => {
    const categoryActs = actsByCategory.get(name) ?? [];
    // Only regular riders get a medal; replacements are listed separately.
    const regular = categoryActs
      .map((act) => act.participants.filter((p) => !p.is_replacement).length)
      .sort((a, b) => b - a);
    const medals = regular.slice(0, PODIUM).reduce((sum, n) => sum + n, 0);
    const first = printed;
    printed += medals;
    return {
      name,
      label: labels.get(name) || name,
      starts: categoryActs.length,
      minPerStart: regular.at(-1) ?? 0,
      maxPerStart: regular[0] ?? 0,
      medals,
      replacements: categoryActs.reduce(
        (sum, act) =>
          sum + act.participants.filter((p) => p.is_replacement).length,
        0,
      ),
      firstSheet: Math.floor(first / STICKERS_PER_SHEET) + 1,
      lastSheet: Math.floor((printed - 1) / STICKERS_PER_SHEET) + 1,
    };
  });
};

/** All stickers in print order, split into sheets of 65. */
const sheetsOf = (categories: MedalCategory[]) => {
  const stickers = categories.flatMap((c) =>
    Array.from({ length: c.medals }, () => c.label),
  );
  const sheets: string[][] = [];
  for (let i = 0; i < stickers.length; i += STICKERS_PER_SHEET) {
    sheets.push(stickers.slice(i, i + STICKERS_PER_SHEET));
  }
  return sheets;
};

@customElement("cup-view-admin-medals")
export default class CupViewAdminMedals extends LitElement {
  static override styles = [
    resetStyles,
    iconStyles,
    adminStyles,
    css`
      .toolbar h1 {
        margin: 0 0.5rem 0 0;
      }

      .sheets {
        display: grid;
        justify-content: center;
        gap: 0.75rem;
        padding: 0.75rem;
        background: var(--cup-surface-2);
      }

      .sheet-label {
        color: var(--cup-muted);
        font-size: 11px;
      }

      /* One A4 sticker sheet; the layout matches the sticker paper. */
      .sheet {
        display: grid;
        padding: 10.9mm 4.7mm 8mm;
        grid-template-columns: repeat(5, 1fr);
        grid-template-rows: repeat(13, 1fr);
        gap: 0 2.5mm;
        width: 210mm;
        height: 297mm;
        background: #fff;
        color: #000;
        box-shadow: 0 1px 4px rgb(0 0 0 / 25%);
        break-inside: avoid;
      }

      .sticker {
        border-radius: 2.5mm;
        display: grid;
        place-items: center;
        font-weight: bold;
        font-size: 1rem;
        line-height: 1.2;
        text-align: center;
        text-wrap: balance;
        outline: 1px dashed var(--cup-border);
        outline-offset: -1px;
      }

      @media print {
        .sheets {
          display: block;
          padding: 0;
          background: none;
        }

        .sheet {
          width: auto;
          height: 100vh;
          box-shadow: none;
          break-after: page;
        }

        .sheet:last-child {
          break-after: auto;
        }

        .sticker {
          outline: none;
        }
      }
    `,
  ];

  private data = new Task(this, {
    args: () => [],
    task: async () => {
      const [categories, startlist] = await Promise.all([
        client.GET("/api/query/list_categories"),
        client.GET("/api/query/startlist"),
      ]);
      const summary = summarize(unwrap(categories), unwrap(startlist));
      return { summary, sheets: sheetsOf(summary) };
    },
  });

  override render() {
    return this.data.render({
      pending: () => html`<p class="page-pad empty">Lade Startliste …</p>`,
      error: (error) =>
        html`<div class="page-pad">
          <div class="error-banner" role="alert">
            <span
              >Startliste konnte nicht geladen werden:
              ${errorMessage(error)}</span
            >
            <button class="btn small" @click=${this.reload}>
              Erneut laden
            </button>
          </div>
        </div>`,
      complete: ({ summary, sheets }) =>
        html`${this.renderSummary(summary, sheets.length)}
          <div class="sheets">
            ${repeat(
              sheets,
              (sheet, index) =>
                html`<div class="sheet-label no-print">
                    Bogen ${index + 1} von ${sheets.length} ·
                    ${sheet.length} Aufkleber
                  </div>
                  <div class="sheet">
                    ${repeat(
                      sheet,
                      (label) => html`<div class="sticker">${label}</div>`,
                    )}
                  </div>`,
            )}
          </div>`,
    });
  }

  private renderSummary(summary: MedalCategory[], sheetCount: number) {
    const total = (key: "starts" | "medals" | "replacements") =>
      summary.reduce((sum, c) => sum + c[key], 0);
    const medals = total("medals");
    return html`<div class="page-pad no-print">
      <div class="toolbar">
        <h1>Medaillen</h1>
        <div class="kpis">
          <span class="kpi"><b>${medals}</b> Medaillen</span>
          <span class="kpi"
            ><b>${sheetCount}</b> ${sheetCount === 1 ? "Bogen" : "Bögen"} à
            ${STICKERS_PER_SHEET}</span
          >
          <span class="kpi"><b>${total("starts")}</b> Starts</span>
          <span class="kpi" title="Ersatzfahrer bekommen keinen Aufkleber"
            ><b>${total("replacements")}</b> Ersatzfahrer</span
          >
        </div>
        <span class="spacer"></span>
        <button
          class="btn primary small"
          ?disabled=${medals === 0}
          @click=${this.print}
        >
          <span class="material-icon">print</span> Drucken
        </button>
      </div>
      <p class="muted small">
        Je Kategorie ein Aufkleber für jede Fahrerin und jeden Fahrer der
        ${PODIUM} Starts mit den meisten Fahrern (Podest), ohne Ersatzfahrer.
        Gedruckt wird auf A4-Bögen mit 5 × 13 Aufklebern, ohne Seitenränder.
      </p>
      <table class="dense fit">
        <thead>
          <tr>
            <th>Kategorie</th>
            <th>Aufschrift</th>
            <th class="num">Starts</th>
            <th
              class="num"
              title="Fahrer je Start (ohne Ersatzfahrer); bei Gruppen kleinster bis größter Start"
            >
              Medaillen/Start
            </th>
            <th class="num" title="Fahrer der 3 größten Starts">Summe</th>
            <th class="num" title="Ersatzfahrer, ohne Aufkleber">Ersatz</th>
            <th class="num">Bogen</th>
          </tr>
        </thead>
        <tbody>
          ${repeat(
            summary.filter((c) => c.starts > 0),
            (c) => c.name,
            (c) =>
              html`<tr>
                <td><b>${c.name}</b></td>
                <td>${c.label === c.name ? "" : c.label}</td>
                <td class="num">${c.starts}</td>
                <td class="num">
                  ${
                    c.minPerStart === c.maxPerStart
                      ? c.maxPerStart
                      : `${c.minPerStart}–${c.maxPerStart}`
                  }
                </td>
                <td class="num">${c.medals}</td>
                <td class="num">${c.replacements || ""}</td>
                <td class="num">
                  ${
                    c.medals === 0
                      ? ""
                      : c.firstSheet === c.lastSheet
                        ? c.firstSheet
                        : `${c.firstSheet}–${c.lastSheet}`
                  }
                </td>
              </tr>`,
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">Summe</td>
            <td class="num">${total("starts")}</td>
            <td></td>
            <td class="num">${medals}</td>
            <td class="num">${total("replacements")}</td>
            <td class="num">${sheetCount}</td>
          </tr>
        </tfoot>
      </table>
      ${
        summary.some((c) => c.starts === 0)
          ? html`<p class="small muted">
              Kategorien ohne Starts:
              ${summary
                .filter((c) => c.starts === 0)
                .map((c) => c.name)
                .join(", ")}
            </p>`
          : nothing
      }
      ${
        medals === 0
          ? html`<p class="empty">Noch keine Starts mit Kategorie.</p>`
          : nothing
      }
    </div>`;
  }

  private print() {
    window.print();
  }

  private reload() {
    this.data.run();
  }
}
