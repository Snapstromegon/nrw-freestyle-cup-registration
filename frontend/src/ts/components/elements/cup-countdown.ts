import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("cup-countdown")
export default class CupCountdown extends LitElement {
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
    super.connectedCallback?.();
    this.#intervalId = setInterval(() => this.requestUpdate(), 1000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback?.();
    if (this.#intervalId) {
      clearInterval(this.#intervalId);
    }
  }

  @property({ attribute: false }) time?: Date;

  get secondsRemaining() {
    return Math.max(
      0,
      Math.floor(((this.time?.getTime() || 0) - Date.now()) / 1000)
    );
  }

  get seconds() {
    return Math.floor(this.secondsRemaining % 60);
  }

  get minutes() {
    return Math.floor((this.secondsRemaining % 3600) / 60);
  }

  override render() {
    console.log(this.secondsRemaining, this.time);
    return html`<div id="wrapper">
      ${this.minutes.toString().padStart(2, "0")}:${this.seconds
        .toString()
        .padStart(2, "0")}
    </div>`;
  }
}
