export class AdvisoryMcpClient {
  constructor(
    private url?: string,
    private token?: string,
  ) {}

  status() {
    return {
      configured: Boolean(this.url),
      available: Boolean(this.url),
      advisoryOnly: true,
    };
  }

  /** Advisory only — returns null when MCP is unset or unreachable. Never throws. */
  async query(question: string): Promise<unknown | null> {
    if (!this.url) return null;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      const r = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name: "search", arguments: { query: question } },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) return null;
      return r.json();
    } catch {
      return null;
    }
  }
}
