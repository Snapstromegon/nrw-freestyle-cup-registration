import { css } from "lit";

/** The reset every component starts from. */
export const resetStyles = css`
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
`;

/**
 * Material Symbols glyphs (the font face is declared in `css/style.css`).
 *
 * - `.material-icon`: a 24px glyph, e.g. `<i class="material-icon">edit</i>`.
 *   Add `.inline` to size it to the surrounding text.
 * - `.icon-btn`: a compact icon-only button with an 18px glyph, e.g.
 *   `<button class="icon-btn" title="Bearbeiten" aria-label="Bearbeiten">edit</button>`.
 *   Colour modifiers: `.primary` (blue), `.ok` (green), `.danger` (red).
 */
export const iconStyles = css`
  .material-icon,
  .icon-btn {
    font-family: "Material Symbols Outlined";
    font-weight: normal;
    font-style: normal;
    line-height: 1;
    letter-spacing: normal;
    text-transform: none;
    white-space: nowrap;
    word-wrap: normal;
    direction: ltr;
    font-feature-settings: "liga";
    -webkit-font-smoothing: antialiased;
  }

  .material-icon {
    font-size: 24px;
    display: inline-block;
  }

  .material-icon.inline {
    font-size: 1.25em;
    vertical-align: -0.25em;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    padding: 0.125rem;
    border: none;
    border-radius: 0.25rem;
    background: transparent;
    color: inherit;
    cursor: pointer;
    vertical-align: middle;
  }

  .icon-btn .material-icon {
    font-size: 18px;
  }

  .icon-btn:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 12%, transparent);
  }

  .icon-btn:focus-visible {
    outline: 2px solid var(--cup-blue-2);
    outline-offset: 0;
  }

  .icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .icon-btn.primary {
    color: var(--cup-blue);
  }

  .icon-btn.ok {
    color: var(--cup-green);
  }

  .icon-btn.danger {
    color: var(--cup-red);
  }
`;
