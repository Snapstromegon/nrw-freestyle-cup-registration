import { css } from "lit";

/**
 * Shared look of the club portal's steps (cup-club-portal and its
 * cup-club-step-* children). Use after the reset and the icon styles.
 *
 * - `.card`: a white panel; `.card > header` its title row (`h3` + actions).
 * - Buttons: `.btn` (outlined), `.btn.primary` (green), `.btn.blue`,
 *   `.btn.danger`; `.btn.small`; icon-only buttons are `.icon-btn` from
 *   `iconStyles`.
 * - `.field` labels a form control (`<label class="field"><span>Name</span>
 *   <input></label>`), `.form-row` lines them up and wraps.
 * - `.chip` small labels with `.ok`, `.warn`, `.error`, `.muted` variants,
 *   `.toggle-chip` filter buttons (`aria-pressed`).
 * - `.banner` messages with `.error`, `.warn`, `.info`, `.ok`.
 * - `.empty` an empty-state panel, `.muted` and `.hint` texts.
 */
export const clubPortalStyles = css`
  :host {
    color: var(--cup-text);
  }

  h2 {
    font-size: 1.5rem;
    color: var(--cup-blue);
  }

  h3 {
    font-size: 1.1rem;
    color: var(--cup-blue);
  }

  a {
    color: var(--cup-blue);
  }

  .step-intro {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 1rem;
  }

  .step-intro p {
    color: var(--cup-muted);
    max-width: 70ch;
  }

  .card {
    background: var(--cup-surface);
    border: 1px solid var(--cup-border);
    border-radius: 0.75rem;
    padding: 1rem;
  }

  .card + .card,
  .stack > * + * {
    margin-top: 1rem;
  }

  .card > header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .card > header > h3 {
    margin-right: auto;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    min-height: 2.25rem;
    padding: 0.375rem 0.875rem;
    border: 1px solid var(--cup-border);
    border-radius: 100vh;
    background: var(--cup-surface);
    color: var(--cup-blue);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    text-decoration: none;
  }

  .btn:hover:not(:disabled) {
    background: var(--cup-surface-2);
  }

  .btn:focus-visible,
  .toggle-chip:focus-visible {
    outline: 2px solid var(--cup-blue-2);
    outline-offset: 2px;
  }

  .btn .material-icon {
    font-size: 20px;
  }

  .btn.primary {
    background: var(--cup-green);
    border-color: var(--cup-green);
    color: #fff;
  }

  .btn.primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--cup-green) 85%, #000);
  }

  .btn.blue {
    background: var(--cup-blue);
    border-color: var(--cup-blue);
    color: #fff;
  }

  .btn.blue:hover:not(:disabled) {
    background: color-mix(in srgb, var(--cup-blue) 85%, #fff);
  }

  .btn.danger {
    color: var(--cup-red);
  }

  .btn.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--cup-red) 8%, var(--cup-surface));
  }

  .btn.small {
    min-height: 1.875rem;
    padding: 0.125rem 0.625rem;
    font-size: 0.875rem;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.875rem;
    color: var(--cup-muted);
    min-width: 0;
  }

  .field > span {
    font-weight: 600;
  }

  input[type="text"],
  input[type="date"],
  input[type="number"],
  input[type="search"],
  input:not([type]),
  select,
  textarea {
    font: inherit;
    font-size: 1rem;
    color: var(--cup-text);
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--cup-border);
    border-radius: 0.375rem;
    background: var(--cup-surface);
    min-width: 0;
  }

  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--cup-blue-2);
    outline-offset: 0;
    border-color: var(--cup-blue);
  }

  textarea {
    width: 100%;
    resize: vertical;
  }

  .form-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: flex-end;
  }

  .form-row > .field {
    flex: 1 1 10rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.0625rem 0.5rem;
    border-radius: 100vh;
    background: color-mix(in srgb, var(--cup-blue-2) 35%, var(--cup-surface));
    color: var(--cup-blue);
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1.5;
    white-space: nowrap;
  }

  .chip .material-icon {
    font-size: 15px;
  }

  .chip.ok {
    background: color-mix(in srgb, var(--cup-green) 12%, var(--cup-surface));
    color: var(--cup-green);
  }

  .chip.warn {
    background: color-mix(in srgb, var(--cup-amber) 12%, var(--cup-surface));
    color: var(--cup-amber);
  }

  .chip.error {
    background: color-mix(in srgb, var(--cup-red) 10%, var(--cup-surface));
    color: var(--cup-red);
  }

  .chip.muted {
    background: var(--cup-surface-2);
    color: var(--cup-muted);
  }

  .toggle-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.75rem;
    border: 1px solid var(--cup-border);
    border-radius: 100vh;
    background: var(--cup-surface);
    color: var(--cup-muted);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .toggle-chip .material-icon {
    font-size: 16px;
  }

  .toggle-chip[aria-pressed="true"] {
    background: var(--cup-blue);
    border-color: var(--cup-blue);
    color: #fff;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .toolbar input[type="search"] {
    flex: 1 1 12rem;
    max-width: 20rem;
  }

  .banner {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid var(--cup-border);
    background: var(--cup-surface-2);
    white-space: pre-line;
    margin-bottom: 1rem;
  }

  .banner > .material-icon {
    font-size: 20px;
  }

  .banner > .grow {
    flex: 1;
  }

  .banner.error {
    border-color: var(--cup-red);
    background: color-mix(in srgb, var(--cup-red) 6%, var(--cup-surface));
    color: var(--cup-red);
  }

  .banner.warn {
    border-color: color-mix(in srgb, var(--cup-amber) 50%, var(--cup-surface));
    background: color-mix(in srgb, var(--cup-amber) 8%, var(--cup-surface));
    color: var(--cup-amber);
  }

  .banner.info {
    border-color: var(--cup-blue-2);
    background: color-mix(in srgb, var(--cup-blue-2) 15%, var(--cup-surface));
    color: var(--cup-blue);
  }

  .banner.ok {
    border-color: color-mix(in srgb, var(--cup-green) 50%, var(--cup-surface));
    background: color-mix(in srgb, var(--cup-green) 8%, var(--cup-surface));
    color: var(--cup-green);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 2rem 1rem;
    text-align: center;
    color: var(--cup-muted);
    border: 2px dashed var(--cup-border);
    border-radius: 0.75rem;
  }

  .empty > .material-icon {
    font-size: 40px;
    color: var(--cup-blue-2);
  }

  .muted {
    color: var(--cup-muted);
  }

  .hint {
    color: var(--cup-muted);
    font-size: 0.875rem;
  }

  .next-step {
    display: flex;
    justify-content: flex-end;
    margin-top: 1.5rem;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  /* Key figures, e.g. of the payment and jury steps. */
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 1rem;
    border-radius: 0.75rem;
    border: 1px solid var(--cup-border);
    background: var(--cup-surface);
  }

  .tile span {
    color: var(--cup-muted);
    font-size: 0.875rem;
  }

  .tile strong {
    font-size: 1.5rem;
    color: var(--cup-blue);
  }

  .tile.open {
    background: var(--cup-blue);
    border-color: var(--cup-blue);
  }

  .tile.open span {
    color: var(--cup-blue-2);
  }

  .tile.open strong {
    color: #fff;
  }

  .tile.done {
    background: var(--cup-green);
    border-color: var(--cup-green);
  }

  .tile.done span,
  .tile.done strong {
    color: #fff;
  }

  @media print {
    .btn,
    .icon-btn,
    .toolbar,
    .next-step {
      display: none !important;
    }
  }
`;
