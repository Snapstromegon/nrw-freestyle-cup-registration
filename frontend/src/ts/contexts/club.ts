import { createContext } from "@lit/context";
import type { components } from "../bindings.js";

export type Club = components["schemas"]["Club"];
export const clubContext = createContext<Club | null>(Symbol("club"));
