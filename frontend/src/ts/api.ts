// Helpers around the openapi-fetch client. openapi-fetch never throws on HTTP
// errors, it returns `{ data, error, response }` instead; `unwrap` turns an
// error into an exception with a German message.
//
// This module only has type imports, so the unit tests can import it without
// a DOM.
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { components } from "./bindings";

type ClientError = components["schemas"]["ClientError"];

const statusMessages: Record<number, string> = {
  400: "Ungültige Anfrage – bitte neu laden",
  401: "Nicht angemeldet",
  403: "Keine Berechtigung",
  404: "Nicht gefunden",
  409: "Konflikt – bitte neu laden",
  413: "Datei zu groß",
  415: "Ungültige Anfrage",
  422: "Ungültige Eingabe",
};

/** Fallback for a status without its own message: refused (4xx) or failed. */
const statusFallback = (status: number) =>
  status >= 400 && status < 500
    ? `Anfrage abgelehnt (${status})`
    : `Serverfehler (${status})`;

/** Message for a request that `PollController` (or a caller) aborted. */
const timeoutMessage = "Zeitüberschreitung – keine Antwort vom Server";

/**
 * Undoes Rust's `Debug` formatting of a string (`"\"Text\""`), which the
 * backend uses for its German error messages.
 */
const undebug = (message: string) => {
  if (
    message.length < 2 ||
    !message.startsWith('"') ||
    !message.endsWith('"')
  ) {
    return message;
  }
  const escapes: Record<string, string> = {
    n: "\n",
    r: "\r",
    t: "\t",
    "0": "\0",
  };
  return message
    .slice(1, -1)
    .replace(
      /\\(u\{([0-9a-fA-F]{1,6})\}|.)/g,
      (_, seq: string, hex?: string) =>
        hex ? String.fromCodePoint(parseInt(hex, 16)) : (escapes[seq] ?? seq),
    );
};

const isClientError = (error: unknown): error is ClientError =>
  typeof error === "object" &&
  error !== null &&
  typeof (error as { type?: unknown }).type === "string";

/**
 * A German message for anything an API call or a command can fail with: the
 * `error` of an openapi-fetch response (`ClientError`, or the plain text some
 * auth failures return), a thrown `Error`, a network failure or a timeout.
 * `status` is the HTTP status, if known, and only used for errors without a
 * message.
 */
export function errorMessage(error: unknown, status?: number): string {
  if (isClientError(error)) {
    switch (error.type) {
      case "Generic":
        return undebug(error.message).trim() || "Unbekannter Fehler";
      case "StatusCode":
        return statusMessages[error.message] ?? statusFallback(error.message);
      case "InvalidCredentials":
        return "Nicht angemeldet oder keine Berechtigung";
      case "NotFound":
        return "Nicht gefunden";
      case "InternalServerError":
        return "Interner Serverfehler";
    }
  }
  if (status !== undefined && statusMessages[status]) {
    return statusMessages[status];
  }
  if (
    error instanceof TypeError &&
    /fetch|network|load failed/i.test(error.message)
  ) {
    return "Keine Verbindung zum Server";
  }
  const name =
    typeof error === "object" && error !== null
      ? (error as { name?: unknown }).name
      : undefined;
  if (name === "TimeoutError" || name === "AbortError") {
    return timeoutMessage;
  }
  if (error instanceof Error) {
    return error.message || "Unbekannter Fehler";
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (status !== undefined && status >= 400) {
    return statusFallback(status);
  }
  return "Unbekannter Fehler";
}

/** Thrown by `unwrap`; `message` is German and can be shown as it is. */
export class ApiError extends Error {
  constructor(
    message: string,
    /** The HTTP status, if there was a response. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Returns the data of an openapi-fetch response, or throws an `ApiError`
 * with a German message:
 * `const acts = unwrap(await client.GET("/api/query/list_acts"));`
 */
export function unwrap<T>(resp: {
  data?: T;
  error?: unknown;
  response?: Response;
}): T {
  const status = resp.response?.status;
  if (resp.error !== undefined || (resp.response && !resp.response.ok)) {
    throw new ApiError(errorMessage(resp.error, status), status);
  }
  return resp.data as T;
}

/**
 * Calls `callback` every `intervalMs` while the host is connected and the page
 * is visible. It does not run on connect (load the initial data as usual);
 * when a hidden page becomes visible again it runs at once. A call is skipped
 * while the previous one is still running; errors are logged, not thrown.
 *
 * A call that hangs (e.g. a request lost on a flaky network) would stop the
 * polling, so it is given up after `timeoutMs` (by default three intervals,
 * at least 10 s): its `signal` is aborted and the next tick runs again. Pass
 * the signal on to the requests, so they are cancelled as well:
 *
 * `poll = new PollController(this, 2000, (signal) => this.load(signal));`
 * `… await client.GET("/api/query/predict_timeplan", { signal }) …`
 */
export class PollController implements ReactiveController {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    host: ReactiveControllerHost,
    private readonly intervalMs: number,
    private readonly callback: (signal: AbortSignal) => unknown,
    private readonly timeoutMs = Math.max(10_000, intervalMs * 3),
  ) {
    host.addController(this);
  }

  hostConnected() {
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.start();
  }

  hostDisconnected() {
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.stop();
  }

  /** Runs the callback now, e.g. right after a command changed the data. */
  async runNow() {
    if (this.running) {
      return;
    }
    this.running = true;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const reason = new DOMException(timeoutMessage, "TimeoutError");
        controller.abort(reason);
        reject(reason);
      }, this.timeoutMs);
    });
    try {
      await Promise.race([this.callback(controller.signal), timedOut]);
    } catch (error) {
      console.error(error);
    } finally {
      clearTimeout(timeout);
      this.running = false;
    }
  }

  private start() {
    if (this.timer !== undefined || document.visibilityState === "hidden") {
      return;
    }
    this.timer = setInterval(() => this.runNow(), this.intervalMs);
  }

  private stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      this.stop();
    } else {
      this.runNow();
      this.start();
    }
  };
}
