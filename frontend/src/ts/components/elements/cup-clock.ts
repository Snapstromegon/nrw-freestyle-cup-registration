import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("cup-clock")
export default class CupClock extends LitElement {
  static override styles = css`
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    #wrapper {
      font-size: 10vh;
      font-variant-numeric: tabular-nums;
      font-family: "Mona Sans";
    }
  `;

  #intervalId: number | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#intervalId = setInterval(() => this.requestUpdate(), 1000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#intervalId) {
      clearInterval(this.#intervalId);
    }
  }

  override render() {
    return html`<div id="wrapper">
      ${new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })}
    </div>`;
  }
}
