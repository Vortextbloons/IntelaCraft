import {
  HttpHeader,
  HttpRequest,
  HttpRequestMethod,
  http,
} from "@minecraft/server-net";
import type { SecretString } from "@minecraft/server-admin";

export class ControllerHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ControllerHttpError";
  }
}

export class ControllerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken: SecretString | string,
  ) {}

  async postJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const req = new HttpRequest(`${this.baseUrl}${path}`);
    req.method = HttpRequestMethod.Post;
    req.body = JSON.stringify(body);
    req.timeout = 10;
    req.headers = [
      new HttpHeader("Content-Type", "application/json"),
      // Secret must already be the full header value, e.g. "Bearer <token>"
      // (SecretString cannot be concatenated in script).
      new HttpHeader("Authorization", this.authToken),
    ];
    const response = await http.request(req);
    let parsed: unknown = null;
    if (response.body) {
      try {
        parsed = JSON.parse(response.body);
      } catch {
        parsed = { raw: response.body };
      }
    }
    if (response.status < 200 || response.status >= 300) {
      const err =
        parsed &&
        typeof parsed === "object" &&
        "error" in parsed &&
        (parsed as { error?: { message?: string; code?: string } }).error
          ? (parsed as { error?: { message?: string; code?: string } }).error
          : undefined;
      const message =
        err && typeof err.message === "string"
          ? err.message
          : `HTTP ${response.status}`;
      throw new ControllerHttpError(response.status, message);
    }
    return { status: response.status, body: parsed };
  }
}
