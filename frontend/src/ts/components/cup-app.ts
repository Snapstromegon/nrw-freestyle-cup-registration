import { LitElement, html, TemplateResult, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Task } from "@lit/task";
import "./views/cup-view-not-found.js";
import "./elements/cup-context-user.js";
import "./elements/cup-context-system-status.js";
// @ts-ignore: Property 'UrlPattern' does not exist
if (!globalThis.URLPattern) {
  await import("urlpattern-polyfill");
}

interface Route {
  path: URLPattern;
  load: () => Promise<unknown>;
  render: (urlPatternExec: URLPatternResult | null) => TemplateResult;
}

const authed = (x: TemplateResult) =>
  html`<cup-context-user>${x}</cup-context-user>`;

@customElement("cup-app")
export default class CupApp extends LitElement {
  @state() location: string = location.pathname;

  private routes: Route[] = [
    {
      path: new URLPattern({ pathname: "/" }),
      load: () => import("./views/cup-view-home.js"),
      render: () => authed(html`<cup-view-home></cup-view-home>`),
    },
    {
      path: new URLPattern({ pathname: "/admin" }),
      load: () => import("./views/cup-view-admin.js"),
      render: () => authed(html`<cup-view-admin></cup-view-admin>`),
    },
    {
      path: new URLPattern({ pathname: "/admin-starters" }),
      load: () => import("./views/cup-view-admin-starters.js"),
      render: () => authed(html`<cup-view-admin-starters></cup-view-admin-starters>`),
    },
    {
      path: new URLPattern({ pathname: "/register" }),
      load: () => import("./views/cup-view-register.js"),
      render: () => html`<cup-view-register></cup-view-register>`,
    },
    {
      path: new URLPattern({ pathname: "/verify_email" }),
      load: () => import("./views/cup-view-verify-email.js"),
      render: () => html`<cup-view-verify-email></cup-view-verify-email>`,
    },
    {
      path: new URLPattern({ pathname: "/request_password_reset" }),
      load: () => import("./views/cup-view-request-password-reset.js"),
      render: () =>
        html`<cup-view-request-password-reset></cup-view-request-password-reset>`,
    },
    {
      path: new URLPattern({ pathname: "/reset_password" }),
      load: () => import("./views/cup-view-reset-password.js"),
      render: () => html`<cup-view-reset-password></cup-view-reset-password>`,
    },
    {
      path: new URLPattern({ pathname: "/create_club" }),
      load: () => import("./views/cup-view-create-club.js"),
      render: () => html`<cup-view-create-club></cup-view-create-club>`,
    },
  ];

  get currentRoute() {
    return this.routes.find((route) =>
      route.path.test(this.location, location.origin)
    );
  }

  private routeTask = new Task(this, {
    task: async () => {
      console.log("Loading route...", this.location, location.pathname);
      if (!this.currentRoute) {
        throw new Error("Current Route does not exist.");
      }
      await this.currentRoute.load();
      return {
        route: this.currentRoute,
        urlPatternExec: this.currentRoute.path.exec(
          this.location,
          location.origin
        ),
      };
    },
    args: () => [this.location],
  });

  override render() {
    return this.routeTask.render({
      pending: () => html`<div>Loading...</div>`,
      error: () =>
        html`<cup-view-not-found .url=${this.location}></cup-view-not-found>`,
      complete: ({ route, urlPatternExec }) =>
        html`<cup-context-system-status>${route ? route.render(urlPatternExec) : nothing}</cup-context-system-status>`,
    });
  }
}
