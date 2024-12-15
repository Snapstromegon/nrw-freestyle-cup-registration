import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("cup-view-not-found")
export default class CupViewHome extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: 1rem;
    }`;

  @property() url: string = "";

  override render() {
    return html` <h1>Wie bist du hier hin gekommen?</h1>
      <p><code>${this.url}</code> ist keine gültige URL.</p>
      <p><a href="/">Hier geht es zurück zur Startseite.</a></p>`;
  }
}
