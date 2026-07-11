import { WELCOME_TEXT } from "../constants";
import type { ChatMsg } from "../types";

export function uid(prefix = "msg") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getAiMode(): "ask" | "agent" {
  try {
    return localStorage.getItem("intelacraft_ai_mode") === "agent" ? "agent" : "ask";
  } catch {
    return "ask";
  }
}

export function saveAiMode(mode: "ask" | "agent") {
  try {
    localStorage.setItem("intelacraft_ai_mode", mode);
  } catch {
    // Private browsing can deny storage; the active in-memory selection still works.
  }
}

export function welcomeMsg(): ChatMsg {
  return { id: "welcome", role: "system", text: WELCOME_TEXT };
}
