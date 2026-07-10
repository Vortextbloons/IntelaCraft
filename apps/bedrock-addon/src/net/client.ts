import {
  HttpHeader,
  HttpRequest,
  HttpRequestMethod,
  http,
} from "@minecraft/server-net";
import type { SecretString } from "@minecraft/server-admin";

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
    return { status: response.status, body: parsed };
  }
}
