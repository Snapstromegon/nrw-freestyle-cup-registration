import { consume } from "@lit/context";
import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { User, userContext } from "../../contexts/user";
import { client } from "../../apiClient";

@customElement("cup-view-reset-password")
export default class CupViewResetPassword extends LitElement {
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

    form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      background: #fff;
      padding: 2rem;
      border-radius: 0.5rem;

      & input,
      button,
      a {
        padding: 0.5rem;
      }

      & button,
      a {
        background: #009036;
        color: #fff;
        border: none;
        border-radius: 0.5rem;
        cursor: pointer;
      }

      & #login {
        background: #fff;
        color: #002d56;
      }
    }

    #action-buttons {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;

      & button,
      & a {
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

    label {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    #error {
      border: 0.1rem solid #e2001a;
      color: #e2001a;
      padding: 0.5rem;
      border-radius: 0.5rem;
    }
  `;
  @consume({ context: userContext, subscribe: true })
  user: User | null = null;
  @state() error?: string = undefined;

  override render() {
    return html`<main>
      <div id="wrapper">
        <aside>
          <img src="/assets/images/nrw-freestyle-cup.svg" />
        </aside>
        <form @submit=${this.register}>
          <h1>NRW Freestyle Cup 2025</h1>
          <h2>Registrierung</h2>
          ${this.error ? html`<p id="error">${this.error}</p>` : nothing}
          <label>
            Passwort
            <input
              type="password"
              name="password"
              placeholder="Passwort"
              required
            />
          </label>
          <label>
            Passwort wiederholen
            <input
              type="password"
              name="passwordRepeat"
              placeholder="Passwort wiederholen"
              required
            />
          </label>
          <div id="action-buttons">
            <button type="submit">
              <i class="material-icon">key</i> Passwort zurücksetzen
            </button>
          </div>
        </form>
      </div>
    </main>`;
  }

  async register(event: SubmitEvent) {
    event.preventDefault();
    const token = new URL(window.location.href).searchParams.get("token");
    if (!token) {
      this.error = "Kein Token gefunden.";
      return;
    }
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries()) as {
      password: string;
      passwordRepeat: string;
    };
    if (data.password !== data.passwordRepeat) {
      this.error = "Passwörter stimmen nicht überein.";
      return;
    }

    const passwordFail = getProblemWithPassword(data.password);
    if (passwordFail) {
      this.error = passwordFail;
      return;
    }

    const resp = await client.POST("/api/command/reset_password", {
      body: {
        token,
        new_password: data.password,
      },
    });

    if (resp.error) {
      console.error(resp.error);
      this.error =
        (resp.error as { message?: string }).message ||
        "Fehler beim Zurücksetzen.";
      return;
    }

    this.error = undefined;
    window.location.href = "/";
  }
}

const getProblemWithPassword = (password: string): string | null => {
  if (password.length < 8) {
    return "Passwort muss mindestens 8 Zeichen lang sein.";
  }

  let categories = 0;
  if (password.match(/[a-z]/)) {
    categories++;
  }
  if (password.match(/[A-Z]/)) {
    categories++;
  }
  if (password.match(/[0-9]/)) {
    categories++;
  }
  if (
    `!"§$%&/()=?+-*#'_~.,:;<>|\\ {[]}`
      .split("")
      .some((char) => password.includes(char))
  ) {
    categories++;
  }

  if (categories < 3) {
    return "Passwort muss mindestens 3 der folgenden Kategorien enthalten: Kleinbuchstaben, Großbuchstaben, Zahlen, Sonderzeichen.";
  }

  return null;
};
