import { useCallback, useState, type FormEvent } from "react";
import { api, clearToken, getToken, setToken } from "../api";

export function useAuth() {
  const [tokenInput, setTokenInput] = useState("");
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setToken(tokenInput.trim());
    try {
      await api("/v1/settings");
      setAuthed(true);
      setError(null);
    } catch (err) {
      clearToken();
      setAuthed(false);
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }, [tokenInput]);

  const signOut = useCallback(() => {
    clearToken();
    setAuthed(false);
  }, []);

  return {
    tokenInput,
    setTokenInput,
    authed,
    setAuthed,
    error,
    setError,
    login,
    signOut,
  };
}
