import { createContext } from "@lit/context";
import type { components } from "../bindings.js";

export type SystemStatus = components["schemas"]["Capabilities"];
export const systemStatusContext = createContext<SystemStatus | null>(
  Symbol("system_status"),
);
