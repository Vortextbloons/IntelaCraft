import type { FormEvent } from "react";

type LoginGateProps = {
  tokenInput: string;
  setTokenInput: (value: string) => void;
  error: string | null;
  onSubmit: (e: FormEvent) => void;
};

export function LoginGate({ tokenInput, setTokenInput, error, onSubmit }: LoginGateProps) {
  return (
    <div className="login-gate">
      <form className="login-panel stack" onSubmit={onSubmit}>
        <h1>IntelaCraft</h1>
        <p>Enter the controller bearer token to open chat.</p>
        <label>
          Bearer token
          <input
            type="password"
            autoComplete="off"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit">
          Enter
        </button>
      </form>
    </div>
  );
}
