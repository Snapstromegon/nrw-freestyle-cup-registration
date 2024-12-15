import { createContext } from "@lit/context";
import { components } from "../bindings.js";

export type User = components["schemas"]["User"];
export const userContext = createContext<User | null>(Symbol("user"));
