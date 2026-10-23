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
