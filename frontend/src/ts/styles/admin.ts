import { css } from "lit";

/**
 * Shared styles of the dense admin pages. Use them after the reset:
 * `static override styles = [resetStyles, iconStyles, adminStyles, css\`…\`]`.
 *
 * Building blocks (see the comments below for details):
 * - `table.dense` (+ `.fit`, `.headless`), cells `.num`, `.c`, `.wrap`,
 *   `.trunc`, `.top`, `.actions`; rows `.ok`, `.warn`, `.bad`, `.info`,
 *   `.muted`, `.current`; sticky `tr.group-head` sub-headers; bold `tfoot`;
 *   sortable headers via `th.sortable` + `aria-sort`.
 * - `.chip` (+ `.ok`, `.warn`, `.bad`, `.info`, `.muted`), `.chips` row,
 *   `button.chip[aria-pressed]` filter toggles.
 * - `.toolbar` (+ `.spacer`), `.kpis` + `.kpi` (+ `.ok`, `.warn`, `.bad`).
 * - `.btn` (+ `.primary`, `.danger`, `.small`, `[aria-pressed]`),
 *   `input.inline`, `select.inline`, `textarea.inline` (+ `.num`).
 * - `.error-banner`, `.warn-banner`, `.ok-banner`, `.info-banner`.
 * - `.ci` check-in marker (`.yes` ✓ / `.no` ○), also as `button.ci`.
 * - `details.block > summary` collapsible sections.
 * - Layout and text helpers: `.page-pad`, `.grid-2`, `.scroll`, `.row`,
 *   `.muted`, `.small`, `.nowrap`, `.empty`, `.text-ok`, `.text-warn`,
 *   `.text-bad`, `.text-info`, `.no-print`, `.print-only`.
 *
 * Sticky table headers stick below the admin shell's top bar
 * (`--admin-sticky-top`, set by `cup-admin-shell`). They only work while no
 * ancestor between the table and the page has its own `overflow`; inside an
 * own scroll container use `.scroll`, which resets the offset to 0.
 */
export const adminStyles = css`
  :host {
    display: block;
    font-size: 13px;
    line-height: 1.35;
    color: var(--cup-text);

    /* Status tones, readable as text on the page and on their background. */
    --tone-ok-fg: color-mix(in srgb, var(--cup-green) 70%, black);
    --tone-ok-bg: color-mix(in srgb, var(--cup-green) 12%, var(--cup-surface));
    --tone-warn-fg: color-mix(in srgb, var(--cup-amber) 78%, black);
    --tone-warn-bg: color-mix(in srgb, var(--cup-amber) 14%, var(--cup-surface));
    --tone-bad-fg: color-mix(in srgb, var(--cup-red) 80%, black);
    --tone-bad-bg: color-mix(in srgb, var(--cup-red) 10%, var(--cup-surface));
    --tone-info-fg: var(--cup-blue);
    --tone-info-bg: color-mix(in srgb, var(--cup-blue-2) 28%, var(--cup-surface));

    /* Height of a dense table's header row; group heads stick below it. */
    --dense-head-h: 1.5rem;
  }

  h1,
  h2,
  h3,
  h4 {
    color: var(--cup-blue);
    font-weight: 650;
    line-height: 1.2;
  }

  h1 {
    font-size: 1.3em;
    margin: 0.25rem 0;
  }

  h2 {
    font-size: 1.15em;
    margin: 0.5rem 0 0.25rem;
  }

  h3 {
    font-size: 1.05em;
    margin: 0.375rem 0 0.25rem;
  }

  h4 {
    font-size: 1em;
  }

  a {
    color: var(--cup-blue);
    text-underline-offset: 2px;
  }

  input[type="checkbox"],
  input[type="radio"] {
    accent-color: var(--cup-blue);
    vertical-align: middle;
  }

  kbd {
    font: 11px/1.3 ui-monospace, monospace;
    padding: 0 0.25em;
    border: 1px solid var(--cup-border);
    border-bottom-width: 2px;
    border-radius: 3px;
    background: var(--cup-surface-2);
  }

  /* ---------- Dense tables ---------- */

  table.dense {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-variant-numeric: tabular-nums;
    line-height: 1.3;
  }

  /* Only as wide as the content, e.g. small summary tables. */
  table.dense.fit {
    width: auto;
  }

  /* Tables without a thead: group heads stick to the top. */
  table.dense.headless {
    --dense-head-h: 0px;
  }

  .dense th,
  .dense td {
    padding: 2px 6px;
    border-bottom: 1px solid var(--cup-border);
    text-align: left;
    vertical-align: middle;
    white-space: nowrap;
  }

  .dense thead th {
    position: sticky;
    top: var(--admin-sticky-top, 0px);
    z-index: 2;
    height: var(--dense-head-h);
    background: var(--cup-surface-2);
    color: var(--cup-muted);
    font-size: 0.92em;
    font-weight: 600;
    border-bottom-color: color-mix(in srgb, var(--cup-muted) 45%, var(--cup-border));
  }

  .dense th.sortable {
    cursor: pointer;
    user-select: none;
  }

  .dense th.sortable:hover {
    color: var(--cup-blue);
  }

  .dense th[aria-sort="ascending"]::after,
  .dense th[aria-sort="descending"]::after {
    content: "▲";
    font-size: 0.75em;
    margin-left: 0.25em;
    color: var(--cup-blue);
  }

  .dense th[aria-sort="descending"]::after {
    content: "▼";
  }

  .dense tbody th {
    font-weight: 600;
  }

  .dense tbody tr:nth-child(even) > td {
    background: color-mix(in srgb, var(--cup-surface-2) 55%, var(--cup-surface));
  }

  .dense tbody tr.ok > td {
    background: var(--tone-ok-bg);
  }

  .dense tbody tr.warn > td {
    background: var(--tone-warn-bg);
  }

  .dense tbody tr.bad > td {
    background: var(--tone-bad-bg);
  }

  .dense tbody tr.info > td {
    background: var(--tone-info-bg);
  }

  .dense tbody tr.muted > td {
    color: var(--cup-muted);
  }

  /* The running act, the selected row, … */
  .dense tbody tr.current > td {
    background: color-mix(in srgb, var(--cup-blue-2) 45%, var(--cup-surface));
    font-weight: 600;
  }

  /* An overlay, so hover keeps the row's status colour visible. */
  .dense tbody tr:hover > td {
    box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--cup-blue) 7%, transparent);
  }

  /* Sticky sub-header inside a tbody, e.g. "EM U15 · 12 Starter". */
  .dense tbody tr.group-head > th {
    position: sticky;
    top: calc(var(--admin-sticky-top, 0px) + var(--dense-head-h));
    z-index: 1;
    background: color-mix(in srgb, var(--cup-blue-2) 30%, var(--cup-surface));
    color: var(--cup-blue);
    font-weight: 700;
    text-align: left;
    border-bottom-color: var(--cup-blue-2);
  }

  .dense tbody tr.group-head > th .muted,
  .dense tbody tr.group-head > th .chip {
    font-weight: 400;
  }

  .dense tfoot td,
  .dense tfoot th {
    position: sticky;
    bottom: 0;
    z-index: 1;
    font-weight: 700;
    background: var(--cup-surface-2);
    border-top: 2px solid color-mix(in srgb, var(--cup-muted) 60%, var(--cup-border));
    border-bottom: none;
  }

  .num,
  .dense th.num,
  .dense td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .c,
  .dense th.c,
  .dense td.c {
    text-align: center;
  }

  /* Long text that may wrap (descriptions, member lists). */
  .dense td.wrap,
  .dense th.wrap {
    white-space: normal;
    overflow-wrap: break-word;
  }

  /* Long text cut to one line; put the full text into a title. */
  .dense td.trunc {
    max-width: 18em;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dense td.top,
  .dense th.top {
    vertical-align: top;
  }

  /* Icon buttons at the end of a row; hidden in print. */
  .dense td.actions,
  .dense th.actions {
    width: 1%;
    padding-top: 0;
    padding-bottom: 0;
    text-align: right;
  }

  /* ---------- Chips ---------- */

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2em;
    padding: 0 0.45em;
    border: 1px solid var(--cup-border);
    border-radius: 999px;
    background: var(--cup-surface-2);
    color: var(--cup-text);
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .chip.ok {
    background: var(--tone-ok-bg);
    color: var(--tone-ok-fg);
    border-color: color-mix(in srgb, var(--cup-green) 35%, var(--cup-surface));
  }

  .chip.warn {
    background: var(--tone-warn-bg);
    color: var(--tone-warn-fg);
    border-color: color-mix(in srgb, var(--cup-amber) 40%, var(--cup-surface));
  }

  .chip.bad {
    background: var(--tone-bad-bg);
    color: var(--tone-bad-fg);
    border-color: color-mix(in srgb, var(--cup-red) 35%, var(--cup-surface));
  }

  .chip.info {
    background: var(--tone-info-bg);
    color: var(--tone-info-fg);
    border-color: var(--cup-blue-2);
  }

  .chip.muted {
    background: transparent;
    color: var(--cup-muted);
    font-weight: 400;
  }

  /* A row of chips without relying on whitespace between them. */
  .chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 2px;
    vertical-align: middle;
  }

  /* Filter toggles: <button class="chip" aria-pressed="true">Musik fehlt</button>. */
  button.chip {
    font-family: inherit;
    cursor: pointer;
  }

  button.chip:hover {
    border-color: var(--cup-blue-2);
  }

  button.chip[aria-pressed="true"] {
    background: var(--cup-blue);
    border-color: var(--cup-blue);
    color: #fff;
  }

  /* ---------- Toolbar and KPI strip ---------- */

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
    padding: 0.25rem 0;
  }

  .toolbar .spacer,
  .row .spacer,
  details.block > summary .spacer {
    flex: 1 1 auto;
  }

  .toolbar label {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    white-space: nowrap;
  }

  .toolbar input[type="search"].inline {
    width: 16em;
  }

  .kpis {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.125rem 1rem;
    padding: 0.25rem 0;
  }

  .kpi {
    color: var(--cup-muted);
    white-space: nowrap;
  }

  .kpi b {
    color: var(--cup-text);
    font-size: 1.15em;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .kpi.ok b {
    color: var(--tone-ok-fg);
  }

  .kpi.warn b {
    color: var(--tone-warn-fg);
  }

  .kpi.bad b {
    color: var(--tone-bad-fg);
  }

  /* ---------- Buttons and inputs ---------- */

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 2px 10px;
    border: 1px solid color-mix(in srgb, var(--cup-muted) 40%, var(--cup-border));
    border-radius: 4px;
    background: var(--cup-surface);
    color: var(--cup-text);
    font: inherit;
    line-height: 1.3;
    white-space: nowrap;
    cursor: pointer;
    vertical-align: middle;
  }

  .btn:hover:not(:disabled) {
    background: var(--cup-surface-2);
    border-color: var(--cup-blue-2);
  }

  .btn:focus-visible {
    outline: 2px solid var(--cup-blue-2);
    outline-offset: 1px;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn .material-icon {
    font-size: 16px;
  }

  .btn.primary {
    background: var(--cup-blue);
    border-color: var(--cup-blue);
    color: #fff;
  }

  .btn.primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--cup-blue) 85%, black);
    border-color: color-mix(in srgb, var(--cup-blue) 85%, black);
  }

  .btn.danger {
    color: var(--tone-bad-fg);
    border-color: color-mix(in srgb, var(--cup-red) 45%, var(--cup-surface));
  }

  .btn.danger:hover:not(:disabled) {
    background: var(--cup-red);
    border-color: var(--cup-red);
    color: #fff;
  }

  .btn.small {
    padding: 0 6px;
    font-size: 11px;
    line-height: 18px;
  }

  .btn[aria-pressed="true"] {
    background: var(--tone-info-bg);
    border-color: var(--cup-blue);
    color: var(--cup-blue);
  }

  input.inline,
  select.inline,
  textarea.inline {
    font: inherit;
    color: inherit;
    line-height: 1.2;
    padding: 1px 4px;
    border: 1px solid color-mix(in srgb, var(--cup-muted) 35%, var(--cup-border));
    border-radius: 3px;
    background: var(--cup-surface);
    max-width: 100%;
    vertical-align: middle;
  }

  select.inline {
    padding: 0 2px;
  }

  input.inline.num {
    width: 6em;
    text-align: right;
  }

  input.inline:focus,
  select.inline:focus,
  textarea.inline:focus {
    outline: 2px solid var(--cup-blue-2);
    outline-offset: -1px;
    border-color: var(--cup-blue);
  }

  input.inline.invalid,
  select.inline.invalid,
  textarea.inline.invalid {
    border-color: var(--cup-red);
    background: var(--tone-bad-bg);
  }

  /* Separate rule: an unsupported selector would drop the whole list. */
  input.inline:user-invalid {
    border-color: var(--cup-red);
    background: var(--tone-bad-bg);
  }

  /* ---------- Banners ---------- */

  .error-banner,
  .warn-banner,
  .ok-banner,
  .info-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin: 0.25rem 0;
    padding: 0.25rem 0.5rem;
    border: 1px solid;
    border-left-width: 4px;
    border-radius: 3px;
    white-space: pre-line;
  }

  .error-banner {
    color: var(--tone-bad-fg);
    background: var(--tone-bad-bg);
    border-color: var(--cup-red);
  }

  .warn-banner {
    color: var(--tone-warn-fg);
    background: var(--tone-warn-bg);
    border-color: var(--cup-amber);
  }

  .ok-banner {
    color: var(--tone-ok-fg);
    background: var(--tone-ok-bg);
    border-color: var(--cup-green);
  }

  .info-banner {
    color: var(--tone-info-fg);
    background: var(--tone-info-bg);
    border-color: var(--cup-blue);
  }

  /* A close button (icon-btn) at the end of a banner. */
  :is(.error-banner, .warn-banner, .ok-banner, .info-banner) > .icon-btn {
    margin: -1px -4px -1px auto;
    font-size: 16px;
  }

  /* ---------- Check-in marker ---------- */

  /*
   * <span class="ci yes" title="eingecheckt"></span> shows a green ✓,
   * <span class="ci no" title="nicht eingecheckt"></span> a grey ○. The glyph
   * comes from CSS while the element is empty.
   */
  .ci {
    display: inline-block;
    min-width: 1em;
    text-align: center;
    font-weight: 700;
    line-height: 1;
  }

  .ci.yes {
    color: var(--tone-ok-fg);
  }

  .ci.no {
    color: var(--cup-muted);
  }

  .ci.yes:empty::before {
    content: "✓";
  }

  .ci.no:empty::before {
    content: "○";
  }

  /* A check-in toggle: <button class="ci yes|no" title="…"></button>. */
  button.ci {
    width: 1.75em;
    height: 1.5em;
    border: 1px solid color-mix(in srgb, var(--cup-muted) 40%, var(--cup-border));
    border-radius: 3px;
    background: var(--cup-surface);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    vertical-align: middle;
  }

  button.ci.yes {
    background: var(--tone-ok-bg);
    border-color: var(--cup-green);
  }

  button.ci:hover:not(:disabled) {
    border-color: var(--cup-blue);
  }

  button.ci:disabled {
    opacity: 0.5;
    cursor: progress;
  }

  /* ---------- Collapsible sections ---------- */

  details.block {
    margin: 0.375rem 0;
    border: 1px solid var(--cup-border);
    border-radius: 4px;
    background: var(--cup-surface);
  }

  details.block > summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.125rem 0.75rem;
    padding: 3px 8px;
    border-radius: 4px;
    background: var(--cup-surface-2);
    color: var(--cup-blue);
    font-weight: 650;
    list-style: none;
    cursor: pointer;
    user-select: none;
  }

  details.block > summary::-webkit-details-marker {
    display: none;
  }

  details.block > summary::before {
    content: "▸";
    display: inline-block;
    width: 0.75em;
    color: var(--cup-muted);
    transition: transform 0.1s;
  }

  details.block[open] > summary {
    border-bottom: 1px solid var(--cup-border);
    border-radius: 4px 4px 0 0;
  }

  details.block[open] > summary::before {
    transform: rotate(90deg);
  }

  details.block > summary:focus-visible {
    outline: 2px solid var(--cup-blue-2);
    outline-offset: -2px;
  }

  details.block > summary :is(.muted, .kpi) {
    font-weight: 400;
  }

  /* ---------- Layout and text helpers ---------- */

  .page-pad {
    padding: 0.5rem 0.75rem;
  }

  .grid-2 {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem 0.75rem;
    align-items: start;
  }

  @media (max-width: 900px) {
    .grid-2 {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* An own scroll container; sticky table headers stick to its top. */
  .scroll {
    overflow: auto;
    min-height: 0;
    --admin-sticky-top: 0px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
  }

  .muted {
    color: var(--cup-muted);
  }

  .small {
    font-size: 11px;
  }

  .nowrap {
    white-space: nowrap;
  }

  .empty {
    padding: 0.25rem 0.5rem;
    color: var(--cup-muted);
    font-style: italic;
  }

  .text-ok {
    color: var(--tone-ok-fg);
  }

  .text-warn {
    color: var(--tone-warn-fg);
  }

  .text-bad {
    color: var(--tone-bad-fg);
  }

  .text-info {
    color: var(--tone-info-fg);
  }

  .print-only {
    display: none;
  }

  @media print {
    :host {
      --admin-sticky-top: 0px;
    }

    .no-print,
    .btn,
    .icon-btn,
    .dense td.actions,
    .dense th.actions,
    .error-banner {
      display: none !important;
    }

    .print-only {
      display: revert;
    }

    .dense thead th,
    .dense tbody tr.group-head > th,
    .dense tfoot td,
    .dense tfoot th {
      position: static;
    }

    .dense tbody tr:hover > td {
      box-shadow: none;
    }

    .dense tr {
      break-inside: avoid;
    }

    details.block {
      border: none;
    }

    details.block > summary::before {
      content: none;
    }
  }
`;
