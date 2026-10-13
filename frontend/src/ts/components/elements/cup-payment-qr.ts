import { css, html, LitElement, nothing, svg } from "lit";
import { customElement, property } from "lit/decorators.js";
import { encode } from "uqr";

/**
 * Renders an EPC payload (see `epc.ts`) as a QR code. It stays black on white
 * with a quiet zone, also in dark mode and in print, so scanners can read it.
 * Renders nothing if the payload doesn't fit.
 */
@customElement("cup-payment-qr")
export default class CupPaymentQr extends LitElement {
  static override styles = css`
    :host {
      display: inline-block;
      width: 180px;
      max-width: 100%;
    }

    svg {
      display: block;
      width: 100%;
      height: auto;
      background: #fff;
      print-color-adjust: exact;
    }
  `;

  @property() payload = "";

  override render() {
    if (!this.payload) {
      return nothing;
    }
    let data: boolean[][];
    try {
      // As UTF-8 bytes, without an ECI header that some scanners don't expect.
      const bytes = Array.from(new TextEncoder().encode(this.payload));
      ({ data } = encode(bytes, { ecc: "M", maxVersion: 13, border: 4 }));
    } catch (error) {
      console.error("Payment QR code failed", error);
      return nothing;
    }
    const path = data
      .flatMap((row, y) =>
        row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : "")),
      )
      .join("");
    return html`<svg
      viewBox="0 0 ${data.length} ${data.length}"
      role="img"
      aria-label="QR-Code für die Überweisung"
      shape-rendering="crispEdges"
    >
      ${svg`<path d=${path} fill="#000" />`}
    </svg>`;
  }
}
