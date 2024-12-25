import { createContext } from "@lit/context";
import { components } from "../bindings.js";

export type SystemStatus = components["schemas"]["Status"];
export const systemStatusContext = createContext<SystemStatus | null>(Symbol("system_status"));
