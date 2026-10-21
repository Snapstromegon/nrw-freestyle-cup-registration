import { createContext } from "@lit/context";
import type { schemas } from "../apiClient";

export type SystemStatus = schemas.SystemStatus;
export const systemStatusContext = createContext<SystemStatus | null>(
  Symbol("system_status"),
);
