// Roles of the organizer team (ADR 0003): their names and the rules for
// granting them. Pure helpers, so the unit tests can import them without a
// DOM.
import type { schemas } from "./apiClient";

export type Role = schemas.Role;

/** Every role, in the order of the role table. */
export const ROLES: readonly Role[] = [
  "admin",
  "jury_lead",
  "treasurer",
  "check_in",
  "music_control",
  "moderation",
  "music_check",
];

export const roleNames: Record<Role, string> = {
  admin: "Admin",
  jury_lead: "Juryleitung",
  treasurer: "Kasse",
  check_in: "Check-in",
  music_control: "Musiksteuerung",
  moderation: "Moderation",
  music_check: "Musikprüfung",
};

/** `roles` with `role` granted (`on`) or revoked, in the table's order. */
export const withRole = (roles: readonly Role[], role: Role, on: boolean) =>
  ROLES.filter((r) => (r === role ? on : roles.includes(r)));

/**
 * Why `role` of `user` can't be revoked, or `null`: admins keep their own
 * Admin role, and the last Admin stays one.
 */
export const roleLock = (
  user: { id: string; roles: readonly Role[] },
  role: Role,
  currentUserId: string | undefined,
  adminCount: number,
) => {
  if (role !== "admin" || !user.roles.includes("admin")) {
    return null;
  }
  if (user.id === currentUserId) {
    return "Die eigene Admin-Rolle kann man nicht abgeben.";
  }
  if (adminCount <= 1) {
    return "Der letzte Admin bleibt Admin.";
  }
  return null;
};
