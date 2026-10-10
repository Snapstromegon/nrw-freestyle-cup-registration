import type { components } from "./bindings";

export enum TimeplanStatus {
  Break = "Break",
  Warmup = "Warmup",
  Act = "Act",
  Judging = "Judging",
  Award = "Award",
}

export const timeplanStatus = (
  timeplan: components["schemas"]["Timeplan"],
): TimeplanStatus => {
  const entry = currentTimeplanEntry(timeplan);
  if (!entry) {
    return TimeplanStatus.Break;
  }
  if ("Category" in entry.timeplan_entry) {
    const currentAct = currentTimeplanAct(timeplan);
    if (currentAct) {
      return TimeplanStatus.Act;
    }
    if (
      entry.timeplan_entry.Category.acts[0].status === "Planned" &&
      entry.timeplan_entry.Category.einfahrzeit_seconds > 0
    ) {
      return TimeplanStatus.Warmup;
    }
    return TimeplanStatus.Judging;
  }
  return TimeplanStatus.Award;
};

export const currentTimeplanEntry = (
  timeplan: components["schemas"]["Timeplan"],
) => {
  return timeplan?.items.find((item) => item.status === "Started");
};

export const nextTimeplanEntry = (
  timeplan: components["schemas"]["Timeplan"],
) => {
  return timeplan?.items.find((item) => item.status === "Planned");
};
export const lastTimeplanEntry = (
  timeplan: components["schemas"]["Timeplan"],
) => {
  return timeplan?.items.findLast((item) => item.status === "Ended");
};

export const currentTimeplanAct = (
  timeplan: components["schemas"]["Timeplan"],
) => {
  const entry = currentTimeplanEntry(timeplan);
  if (!entry || !("Category" in entry.timeplan_entry)) {
    return undefined;
  }
  return entry.timeplan_entry.Category.acts.find(
    (act) => act.status == "Started",
  );
};

export const nextTimeplanAct = (
  timeplan: components["schemas"]["Timeplan"],
) => {
  const currentEntry = currentTimeplanEntry(timeplan);
  if (currentEntry && "Category" in currentEntry.timeplan_entry) {
    const act = currentEntry.timeplan_entry.Category.acts.find(
      (act) => act.status == "Planned",
    );
    if (act) {
      return act;
    }
  }

  const nextEntry = nextTimeplanEntry(timeplan);
  if (!nextEntry || !("Category" in nextEntry.timeplan_entry)) {
    return undefined;
  }
  return nextEntry.timeplan_entry.Category.acts.find(
    (act) => act.status == "Planned",
  );
};

export const lastTimeplanAct = (
  timeplan: components["schemas"]["Timeplan"],
) => {
  const currentEntry = currentTimeplanEntry(timeplan);
  if (currentEntry && "Category" in currentEntry.timeplan_entry) {
    const act = currentEntry.timeplan_entry.Category.acts.findLast(
      (act) => act.status == "Ended",
    );
    if (act) {
      return act;
    }
  }

  const lastEntry = lastTimeplanEntry(timeplan);
  if (!lastEntry || !("Category" in lastEntry.timeplan_entry)) {
    return undefined;
  }
  return lastEntry.timeplan_entry.Category.acts.findLast(
    (act) => act.status == "Ended",
  );
};

export type Competition = components["schemas"]["Competition"];

interface Starts {
  single_male: boolean;
  single_female: boolean;
  pair: boolean;
}

/** Number of starts a starter is registered for. */
export const countStarts = (starter: Starts) =>
  Number(starter.single_male) +
  Number(starter.single_female) +
  Number(starter.pair);

/**
 * Registration fee of one starter: `fee_per_start` per start, capped at
 * `max_fee_per_starter`. Without a competition there is nothing to pay.
 */
export const getStarterPrice = (
  starter: Starts,
  competition:
    | Pick<Competition, "fee_per_start" | "max_fee_per_starter">
    | null
    | undefined,
) => {
  if (!competition) {
    return 0;
  }
  const price = countStarts(starter) * competition.fee_per_start;
  const max = competition.max_fee_per_starter;
  return max === null || max === undefined ? price : Math.min(price, max);
};

/**
 * Formats a date ("2027-06-05") or date-time as a German date ("05.06.2027").
 * Plain dates are shown as they are, independent of the viewer's time zone.
 */
export const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(/^\d{4}-\d{2}-\d{2}$/.test(value) ? { timeZone: "UTC" } : {}),
  });

/** Formats the days of a competition, e.g. "05.06.2027 – 06.06.2027". */
export const formatDateRange = (start: string, end: string) =>
  start === end
    ? formatDate(start)
    : `${formatDate(start)} – ${formatDate(end)}`;

export type ActType = components["schemas"]["ActType"];

/** German name of each act type. */
export const actTypeLabels: Record<ActType, string> = {
  single: "Einzelkür",
  pair: "Paarkür",
};

/** Name of the current competition, with a generic fallback. */
export const competitionName = (competition: Competition | null | undefined) =>
  competition?.name ?? "NRW Freestyle Cup";

/**
 * Whether someone born on `birthdate` is younger than `years` on the
 * competition's determining day. Without a competition, today is used.
 */
export const isUnderAge = (
  birthdate: Date,
  years: number,
  competition: Pick<Competition, "determining_day"> | null | undefined,
) => {
  const day = competition ? new Date(competition.determining_day) : new Date();
  const birthday = new Date(birthdate);
  birthday.setUTCFullYear(birthday.getUTCFullYear() + years);
  return birthday > day;
};
