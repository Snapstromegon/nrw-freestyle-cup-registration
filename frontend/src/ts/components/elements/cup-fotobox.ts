import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

@customElement("cup-fotobox")
export default class CupFotobox extends LitElement {
  static override styles = css`
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    #wrapper {
      display: grid;
      grid-template-columns: 1fr;
      grid-template-rows: 1fr;
      grid-template-areas: "img";
      height: 100%;
      width: 100%;
      min-height: 0;
      min-width: 0;
    }

    img {
      grid-area: img;
      height: 100%;
      width: 100%;
      min-height: 0;
      min-width: 0;
      object-fit: contain;
      opacity: 0;
      transition: opacity 1s;
    }

    .visible {
      opacity: 1;
    }
  `;

  #intervalId: number | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#intervalId = setInterval(() => {
      this.counter=Date.now() / 1000 / 5;
      this.requestUpdate();
    }, 5000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#intervalId) {
      clearInterval(this.#intervalId);
    }
  }

  @property() src?: string;

  /*
  0123456789
  A LVV LVV LV
  B   LVV LVV
  V  AABBAABB
  */
  @state() counter = Date.now() / 1000 / 5;

  get aIndex() {
    return Math.floor(this.counter / 4);
  }
  get bIndex() {
    return Math.floor((this.counter + 2) / 4);
  }

  get aActive() {
    return Math.floor((this.counter - 1) / 2) % 2 === 0;
  }

  override render() {
    console.log(this.counter, this.aIndex, this.bIndex, this.aActive);
    return html`<div id="wrapper">
      <img
        src="${this.src || ""}?${this.aIndex}-a"
        class=${classMap({ visible: this.aActive })}
      />
      <img
        src="${this.src || ""}?${this.bIndex}-b"
        class=${classMap({ visible: !this.aActive })}
      />
    </div>`;
  }
}
