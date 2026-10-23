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

type Role = (typeof ROLES)[number];

/** Judges of one role in a jury category, trained or not. */
export interface RoleCount {
  trained: number;
  untrained: number;
}

export type CategoryCoverage = Record<Role, RoleCount> & {
  /** Registered judges who are 15 on the first competition day. */
  fifteen: number;
};

/**
 * Who can judge what: per jury category and role the registered trained and
 * untrained judges, and how many of them are 15, since a category should
 * have at most three 15-year-old judges (Jury-Konzept 4).
 */
export const coverage = (
  categories: { id: string }[],
  judges: {
    birthdate: string;
    is_trained: boolean;
    registrations: { jury_category_id: string; role: Role }[];
  }[],
  competition: Pick<Competition, "start_date"> | null | undefined,
) => {
  const empty = (): CategoryCoverage => ({
    technical: { trained: 0, untrained: 0 },
    performance: { trained: 0, untrained: 0 },
    dismounts: { trained: 0, untrained: 0 },
    fifteen: 0,
  });
  const result = new Map(categories.map((c) => [c.id, empty()]));
  for (const judge of judges) {
    const isFifteen = ageOnStart(judge.birthdate, competition) === 15;
    const seen = new Set<string>();
    for (const { jury_category_id, role } of judge.registrations) {
      const category = result.get(jury_category_id);
      if (!category) {
        continue;
      }
      category[role][judge.is_trained ? "trained" : "untrained"] += 1;
      if (isFifteen && !seen.has(jury_category_id)) {
        seen.add(jury_category_id);
        category.fifteen += 1;
      }
    }
  }
  return result;
};
