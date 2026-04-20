import { createContext } from "@lit/context";
import type { components } from "../bindings.js";

export type User = components["schemas"]["User"];
export const userContext = createContext<User | null>(Symbol("user"));
