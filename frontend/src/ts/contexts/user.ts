import { createContext } from "@lit/context";
import type { schemas } from "../apiClient";

export type User = schemas.User;
export const userContext = createContext<User | null>(Symbol("user"));
