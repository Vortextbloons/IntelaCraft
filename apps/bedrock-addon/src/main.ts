import { system } from "@minecraft/server";
import { notifyOperators } from "./audit/notify.js";
import { loadConfig } from "./config.js";
import { ControllerSession } from "./net/session.js";

console.warn("[IntelaCraft] Script loading (Phase 1 trusted execution foundation)");

system.run(() => {
  const config = loadConfig();
  if (!config.configured) {
    notifyOperators(
      `Not configured. Missing BDS variables/secrets: ${config.missing.join(", ")}`,
    );
    return;
  }
  const session = new ControllerSession(config);
  session.start();
  notifyOperators("Controller session started");
});
