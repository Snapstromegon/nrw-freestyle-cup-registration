import { LitElement, html, nothing, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { User, userContext } from "../../contexts/user.js";
import { provide } from "@lit/context";
import { client } from "../../apiClient.js";

@customElement("cup-context-user")
export default class CupContextUser extends LitElement {
  static override styles = css`
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    .material-icon {
      font-family: "Material Symbols Outlined";
      font-weight: normal;
      font-style: normal;
      font-size: 24px;
      line-height: 1;
      letter-spacing: normal;
      text-transform: none;
      display: inline-block;
      white-space: nowrap;
      word-wrap: normal;
      direction: ltr;
      font-feature-settings: "liga";
      -webkit-font-smoothing: antialiased;
    }

    main {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
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

    form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      background: #fff;
      padding: 2rem;
      border-radius: 0.5rem;

      & input,
      button, a {
        padding: 0.5rem;
      }

      & button, a {
        background: #009036;
        color: #fff;
        border: none;
        border-radius: 0.5rem;
        cursor: pointer;
      }

      & #register {
        background: #002d56;
      }

      & #pw-reset {
        background: #fff;
        color: #e2001a;
      }
    }

    #action-buttons {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;

      & button, & a {
        flex-grow: 1;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding-right: 1rem;
      }

      & a {
        text-decoration: none;
      }
    }

    #error {
      border: 0.1rem solid #e2001a;
      color: #e2001a;
      padding: 0.5rem;
      border-radius: 0.5rem;
    }
  `;

  @provide({ context: userContext }) user: User | null = null;
  @state() error?: string;

  override render() {
    console.log("this.error", this.error);
    return this.user
      ? html`<slot @login=${this.getLogin} @logout=${this.getLogin}></slot>`
      : html`<main>
          <div id="wrapper">
            <aside>
              <img src="/assets/images/nrw-freestyle-cup.svg" />
            </aside>
            <form @submit=${this.login}>
              <h1>NRW Freestyle Cup 2025</h1>
              <h2>Traineranmeldung</h2>
              ${this.error ? html`<p id="error">${this.error}</p>` : nothing}
              <input
                type="text"
                name="email"
                placeholder="Email"
                required
                autocomplete="on"
                id="email"
              />
              <input
                type="password"
                name="password"
                placeholder="Password"
                autocomplete="on"
                required
                id="password"
              />
              <div id="action-buttons">
                <button type="submit">
                  <i class="material-icon">login</i> Login
                </button>
                <a href="/register" id="register">
                  <i class="material-icon">app_registration</i> Registrieren
                </a>
                <a href="/reset-password" id="pw-reset">
                  <i class="material-icon">key_off</i> Passwort Vergessen
                </a>
              </div>
            </form>
          </div>
        </main>`;
  }

  constructor() {
    super();
    this.getLogin();
  }

  async login(event: SubmitEvent) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const response = await client.POST("/api/command/login", {
      body: {
        email: formData.get("email") as string,
        password: formData.get("password") as string,
      },
    });
    if (response.response.status === 401) {
      this.error = "Invalid email or password.";
      return;
    }
    if (response.error) {
      this.error = "Login failed.";
      return;
    }
    this.getLogin();
  }

  async getLogin() {
    const response = await fetch("/api/query/whoami");
    if (!response.ok) {
      this.user = null;
      this.requestUpdate();
      return;
    }
    const user = await response.json();
    this.user = user;
    this.error = undefined;
    this.requestUpdate();
  }
}
