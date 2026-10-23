// The jury registration (#225): what clubs and admins see about judges. Pure
// helpers, so the unit tests can import them without a DOM.
import type { Competition } from "./utils";

/** End of the judge registration: its own deadline, or the registration's. */
export const judgeRegistrationEnd = (
  competition:
    | Pick<Competition, "registration_end" | "jury">
    | null
    | undefined,
) =>
  competition
    ? (competition.jury?.registration_end ?? competition.registration_end)
    : null;

/** Whether clubs can register judges at `now` (ms). Admins always can. */
export const isJudgeRegistrationOpen = (
  competition:
    | Pick<Competition, "registration_start" | "registration_end" | "jury">
    | null
    | undefined,
  now = Date.now(),
) => {
  const end = judgeRegistrationEnd(competition);
  return (
    !!competition &&
    !!end &&
    Date.parse(competition.registration_start) <= now &&
    now <= Date.parse(end)
  );
};

/**
 * Age in whole years on the first competition day, which decides whether a
 * trained judge is old enough (`jury.min_age`). Null without a competition.
 */
export const ageOnStart = (
  birthdate: string,
  competition: Pick<Competition, "start_date"> | null | undefined,
) => {
  if (!competition) {
    return null;
  }
  const day = new Date(competition.start_date);
  const birth = new Date(birthdate);
  let age = day.getUTCFullYear() - birth.getUTCFullYear();
  if (
    day.getUTCMonth() < birth.getUTCMonth() ||
    (day.getUTCMonth() === birth.getUTCMonth() &&
      day.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
};

/** Short labels of the judge roles: Technik, Performance, Abstiege. */
export const roleLabels = {
  technical: "T",
  performance: "P",
  dismounts: "A",
} as const;

export const roleNames = {
  technical: "Technik",
  performance: "Performance",
  dismounts: "Abstiege",
} as const;

export const ROLES = ["technical", "performance", "dismounts"] as const;
