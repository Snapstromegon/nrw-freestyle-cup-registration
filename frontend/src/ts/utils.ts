import type { components } from "./bindings";

export enum TimeplanStatus {
  Break = "Break",
  Warmup = "Warmup",
  Act = "Act",
  Judging = "Judging",
  Award = "Award",
}

/**
 * What the timeplan shows at `now` (ms). After the last act of a block the
 * block has ended, but the act is still being judged for the category's
 * `judge_duration_seconds` (see `judgingAfterBlockEnd`).
 */
export const timeplanStatus = (
  timeplan: components["schemas"]["Timeplan"],
  now = Date.now(),
): TimeplanStatus => {
  const entry = currentTimeplanEntry(timeplan);
  if (!entry) {
    return judgingAfterBlockEnd(timeplan, now)
      ? TimeplanStatus.Judging
      : TimeplanStatus.Break;
  }
  if ("Category" in entry.timeplan_entry) {
    // A category block that lost its acts while running (e.g. its only group
    // became incomplete) is ended by the next step forward.
    if (entry.timeplan_entry.Category.acts.length === 0) {
      return TimeplanStatus.Break;
    }
    const currentAct = currentTimeplanAct(timeplan);
    if (currentAct) {
      return TimeplanStatus.Act;
    }
    if (
      entry.timeplan_entry.Category.acts[0].status === "Planned" &&
      entry.timeplan_entry.Category.warmup_seconds > 0
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

type TimeplanItem = components["schemas"]["TimeplanItem"];

/**
 * A category block without acts. "Weiter" skips it, so it takes no time and
 * an ended empty block was skipped rather than run.
 */
export const isEmptyBlock = (item: TimeplanItem) =>
  "Category" in item.timeplan_entry &&
  item.timeplan_entry.Category.acts.length === 0;

/** The next entry "Weiter" starts; empty blocks are skipped. */
export const nextTimeplanEntry = (
  timeplan: components["schemas"]["Timeplan"],
) => {
  return timeplan?.items.find(
    (item) => item.status === "Planned" && !isEmptyBlock(item),
  );
};

/** The last entry that really ran, not a skipped empty block. */
export const lastTimeplanEntry = (
  timeplan: components["schemas"]["Timeplan"],
) => {
  return timeplan?.items.findLast(
    (item) => item.status === "Ended" && !isEmptyBlock(item),
  );
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

/**
 * Ending the last act of a block also ends the block, but that act is judged
 * afterwards. While no entry is running and the last ended block's last act
 * ended less than its `judge_duration_seconds` before `now` (ms), returns that
 * block (`entry`), its category and the act; otherwise `undefined`.
 */
export const judgingAfterBlockEnd = (
  timeplan: components["schemas"]["Timeplan"] | null | undefined,
  now = Date.now(),
) => {
  if (!timeplan || currentTimeplanEntry(timeplan)) {
    return undefined;
  }
  const entry = lastTimeplanEntry(timeplan);
  if (!entry || !("Category" in entry.timeplan_entry)) {
    return undefined;
  }
  const category = entry.timeplan_entry.Category;
  const act = category.acts.findLast((a) => a.status === "Ended");
  const endedAt = act?.ended_at ? new Date(act.ended_at).getTime() : NaN;
  // Written so that a missing time or duration (NaN) means "not judging".
  return act && now - endedAt < category.judge_duration_seconds * 1000
    ? { entry, category, act }
    : undefined;
};

export type Competition = components["schemas"]["Competition"];

interface Starts {
  single_male: boolean;
  single_female: boolean;
  pair: boolean;
  /** Group memberships, replacement riders included. Missing counts as 0. */
  group_count?: number | null;
  /** Withdrawn starts whose fee an admin waived. Missing counts as 0. */
  waived_count?: number | null;
}

/** Number of starts a starter is registered for, groups included. */
export const countStarts = (starter: Starts) =>
  Number(starter.single_male) +
  Number(starter.single_female) +
  Number(starter.pair) +
  (starter.group_count ?? 0);

/**
 * Registration fee of one starter: `fee_per_start` per start, capped at
 * `max_fee_per_starter`. Withdrawn starts still cost, unless their fee was
 * waived. Without a competition there is nothing to pay.
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
  const billable = Math.max(
    0,
    countStarts(starter) - (starter.waived_count ?? 0),
  );
  const price = billable * competition.fee_per_start;
  const max = competition.max_fee_per_starter;
  return max === null || max === undefined ? price : Math.min(price, max);
};

/** The local calendar day of a date-time, e.g. "2027-02-12", for grouping. */
export const dayKey = (value: string | Date) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

/** A day heading like "Freitag, 12.02.". */
export const formatDay = (value: string | Date) =>
  new Date(value).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });

/**
 * Splits `items` into days by `start`, for day headings. Returns one group per
 * day, or a single group with an empty `day` if all items are on one day.
 */
export const groupByDay = <T>(items: T[], start: (item: T) => string) => {
  const days: { day: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayKey(start(item));
    const last = days.at(-1);
    if (last?.day === day) {
      last.items.push(item);
    } else {
      days.push({ day, label: formatDay(start(item)), items: [item] });
    }
  }
  if (days.length === 1) {
    days[0].day = "";
  }
  return days;
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
  group_small: "Kleingruppe",
  group_large: "Großgruppe",
};

/** Short code of each act type, for chips and narrow columns. */
export const actTypeShort: Record<ActType, string> = {
  single: "E",
  pair: "P",
  group_small: "KG",
  group_large: "GG",
};

export type GroupActType = Extract<ActType, "group_small" | "group_large">;

/** Whether acts of this type are groups (Kleingruppe or Großgruppe). */
export const isGroupActType = (
  actType: ActType | null | undefined,
): actType is GroupActType =>
  actType === "group_small" || actType === "group_large";

/** Groups need at least this many regular riders to get a category. */
export const MIN_GROUP_SIZE = 3;
/** Groups with more regular riders are Großgruppen. */
export const MAX_SMALL_GROUP_SIZE = 8;

/**
 * The act type of a group with `regular` riders (replacements don't count),
 * or `null` while it is incomplete.
 */
export const groupTypeForSize = (regular: number): GroupActType | null => {
  if (regular < MIN_GROUP_SIZE) {
    return null;
  }
  return regular <= MAX_SMALL_GROUP_SIZE ? "group_small" : "group_large";
};

/**
 * One-line summary of a group, e.g. "KG Junior Expert · 7 Fahrer + 1 Ersatz".
 * `isU15` is `null` when the age group is unknown (it is then left out).
 */
export const describeGroup = (
  regular: number,
  replacements: number,
  isU15: boolean | null,
) => {
  const type = groupTypeForSize(regular);
  if (!type) {
    return `unvollständig – mindestens ${MIN_GROUP_SIZE} Fahrer`;
  }
  const age = isU15 === null ? "" : isU15 ? " Junior Expert" : " Expert";
  const extra = replacements > 0 ? ` + ${replacements} Ersatz` : "";
  return `${actTypeShort[type]}${age} · ${regular} Fahrer${extra}`;
};

/**
 * The song file to play: the loudness-normalized copy once it is ready,
 * unless the original is wanted (e.g. because the copy sounds wrong).
 */
export const songFile = (
  act: { song_file?: string | null; song_file_normalized?: string | null },
  original = false,
) => (original ? act.song_file : (act.song_file_normalized ?? act.song_file));

/** A short German note on the normalized copy of a song, if there is one. */
export const normalizationLabel = (status: string | null | undefined) =>
  status === "pending"
    ? "Lautstärke wird angeglichen…"
    : status === "failed"
      ? "Lautstärke konnte nicht angeglichen werden – es läuft das Original"
      : status === "done"
        ? "Lautstärke angeglichen"
        : "";

/** Name of the current competition, with a generic fallback. */
export const competitionName = (competition: Competition | null | undefined) =>
  competition?.name ?? "Einradevent";

/**
 * Whether clubs can register and change starters at `now` (ms), as the
 * backend decides it for clubs. Unlike `SystemStatus.can_register_starter`
 * this ignores the admins' override, which always reports `true`.
 */
export const isRegistrationOpen = (
  competition:
    | Pick<Competition, "registration_start" | "registration_end">
    | null
    | undefined,
  now = Date.now(),
) =>
  !!competition &&
  Date.parse(competition.registration_start) <= now &&
  now <= Date.parse(competition.registration_end);

/**
 * Whether clubs can upload music at `now` (ms); like `isRegistrationOpen`
 * without the admins' override.
 */
export const isMusicUploadOpen = (
  competition: Pick<Competition, "music_upload_end"> | null | undefined,
  now = Date.now(),
) => !!competition && now <= Date.parse(competition.music_upload_end);

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

/** Formats an amount of money, e.g. "1.234,50 €". Missing amounts are 0. */
export const formatMoney = (amount: number | null | undefined) =>
  `${(Math.round((amount ?? 0) * 100) / 100 || 0).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}\u00a0€`;

const toDate = (value: string | Date | null | undefined) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Formats the local time of a date-time, e.g. "14:05"; "" if missing. */
export const formatTime = (value: string | Date | null | undefined) =>
  toDate(value)?.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }) ?? "";

/** Formats a local date and time compactly, e.g. "05.06. 14:05"; "" if missing. */
export const formatDateTime = (value: string | Date | null | undefined) => {
  const date = toDate(value);
  if (!date) {
    return "";
  }
  const day = date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
  });
  return `${day} ${formatTime(date)}`;
};

/** Formats a duration in seconds as "m:ss", or "h:mm:ss" from one hour on. */
export const formatDuration = (seconds: number | null | undefined) => {
  const total = Math.max(0, Math.round(seconds ?? 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

/**
 * Parses a duration typed as "m:ss", "h:mm:ss" or plain seconds (the inverse
 * of `formatDuration`); `null` if it isn't one.
 */
export const parseDuration = (text: string): number | null => {
  const value = text.trim();
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  const match = /^(?:(\d+):)?(\d+):([0-5]\d)$/.exec(value);
  if (!match || (match[1] !== undefined && Number(match[2]) > 59)) {
    return null;
  }
  return (
    Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])
  );
};

/**
 * Formats an age in years with one decimal, e.g. "14,9"; "" if missing.
 * The decimal is cut off, not rounded, so a 14.96 year old doesn't read as 15.
 */
export const formatAge = (years: number | null | undefined) => {
  if (years === null || years === undefined || Number.isNaN(years)) {
    return "";
  }
  return (Math.floor(years * 10 + 1e-9) / 10).toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
};

/** The parts of an act's participant that the helpers below need. */
export interface ParticipantLike {
  id: string;
  firstname: string;
  lastname: string;
  club_name: string;
  is_replacement?: boolean | null;
}

/** The parts of an act (`Act`, `StartlistAct`, …) the helpers below need. */
export interface ActLike<P extends ParticipantLike = ParticipantLike> {
  act_type: ActType;
  group_name?: string | null;
  participants: P[];
}

/** "Vorname Nachname" of a participant. */
export const participantName = (
  p: Pick<ParticipantLike, "firstname" | "lastname">,
) => `${p.firstname} ${p.lastname}`;

/**
 * Who performs an act, without clubs: the group name for groups, otherwise
 * the riders' names joined with " & ".
 */
export const actParticipantsLabel = (act: {
  act_type: ActType;
  group_name?: string | null;
  participants: Pick<ParticipantLike, "firstname" | "lastname">[];
}) =>
  isGroupActType(act.act_type) && act.group_name
    ? act.group_name
    : act.participants.map(participantName).join(" & ");

/** The distinct club names of an act's participants, in participant order. */
export const actClubNames = (act: {
  participants: Pick<ParticipantLike, "club_name">[];
}) => [...new Set(act.participants.map((p) => p.club_name))];

/** Check-in time per starter id; a missing or empty entry means not checked in. */
export type CheckInMap = ReadonlyMap<string, string | null | undefined>;

/** Builds a `CheckInMap` from the result of `list_check_ins`. */
export const checkInMap = (
  checkIns: { starter_id: string; checked_in_at?: string | null }[],
): CheckInMap =>
  new Map(checkIns.map((c) => [c.starter_id, c.checked_in_at ?? null]));

/**
 * Check-in state of an act's participants. Replacement riders count towards
 * `total`; in `missing` and `missingNames` they come after the regular riders,
 * and their names are marked with "(Ersatz)".
 */
export const checkInStats = <P extends ParticipantLike>(
  participants: P[],
  checkIns: CheckInMap,
) => {
  const missing = participants
    .filter((p) => !checkIns.get(p.id))
    .sort((a, b) => Number(!!a.is_replacement) - Number(!!b.is_replacement));
  return {
    checkedIn: participants.length - missing.length,
    total: participants.length,
    missing,
    missingNames: missing.map(
      (p) => participantName(p) + (p.is_replacement ? " (Ersatz)" : ""),
    ),
  };
};
