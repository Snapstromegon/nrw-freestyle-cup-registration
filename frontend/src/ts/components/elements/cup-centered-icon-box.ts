import { consume } from "@lit/context";
import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { User, userContext } from "../../contexts/user";

@customElement("cup-centered-icon-box")
export default class CupCenteredIconBox extends LitElement {
  static override styles = css`
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :host {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100dvh;
      background: #99add7;
      padding: 1rem;
    }

    #wrapper {
      display: flex;
      background: #fff;
      border-radius: 0.5rem;
      overflow: hidden;
      flex-wrap: wrap;
      place-content: center;

      & aside {
        width: 15rem;
        flex-grow: 1;
        display: flex;
        place-items: center;
        justify-content: center;
        padding: 2rem;
        background: #002d56;

        & img {
          width: 100%;
          max-width: 12rem;
          max-height: 12rem;
          height: 100%;
        }
      }
    }
  `;
  @consume({ context: userContext, subscribe: true })
  user: User | null = null;
  @state() error?: string = undefined;

  override render() {
    return html`<div id="wrapper">
      <aside>
        <img src="/assets/images/nrw-freestyle-cup.svg" />
      </aside>
      <main><slot></slot></main>
    </div>`;
  }
}
