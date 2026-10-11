/* global process, DOMException */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ApiError, errorMessage, unwrap } from "../src/ts/api.ts";
import {
  actClubNames,
  actParticipantsLabel,
  actTypeLabels,
  actTypeShort,
  checkInMap,
  checkInStats,
  countStarts,
  currentTimeplanAct,
  currentTimeplanEntry,
  describeGroup,
  formatAge,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatTime,
  getStarterPrice,
  groupTypeForSize,
  isGroupActType,
  isMusicUploadOpen,
  isRegistrationOpen,
  isUnderAge,
  judgingAfterBlockEnd,
  lastTimeplanAct,
  lastTimeplanEntry,
  MAX_SMALL_GROUP_SIZE,
  MIN_GROUP_SIZE,
  nextTimeplanAct,
  nextTimeplanEntry,
  parseDuration,
  TimeplanStatus,
  timeplanStatus,
} from "../src/ts/utils.ts";

// Pin the time zone, so date assertions don't depend on the machine. Nothing
// above creates dates, so setting it after the imports is early enough.
process.env.TZ = "Europe/Berlin";

const act = (id, status) => ({ id, name: id, status });

const category = (name, status, acts, einfahrzeit_seconds = 600) => ({
  status,
  timeplan_entry: {
    Category: { name, einfahrzeit_seconds, acts },
  },
});

const custom = (label, status) => ({
  status,
  timeplan_entry: { Custom: { label, duration_seconds: 60 } },
});

const timeplan = (...items) => ({ offset: 0, items });

describe("timeplan entries", () => {
  const plan = timeplan(
    category("A", "Ended", [act("a1", "Ended")]),
    custom("Pause", "Ended"),
    category("B", "Started", [act("b1", "Started")]),
    category("C", "Planned", [act("c1", "Planned")]),
    custom("Siegerehrung", "Planned"),
  );

  test("currentTimeplanEntry returns the started entry", () => {
    assert.equal(currentTimeplanEntry(plan), plan.items[2]);
  });

  test("nextTimeplanEntry returns the first planned entry", () => {
    assert.equal(nextTimeplanEntry(plan), plan.items[3]);
  });

  test("lastTimeplanEntry returns the most recently ended entry", () => {
    assert.equal(lastTimeplanEntry(plan), plan.items[1]);
  });

  test("all lookups tolerate a missing timeplan", () => {
    assert.equal(currentTimeplanEntry(undefined), undefined);
    assert.equal(nextTimeplanEntry(undefined), undefined);
    assert.equal(lastTimeplanEntry(undefined), undefined);
  });
});

describe("timeplanStatus", () => {
  test("is Break when no entry is running", () => {
    const plan = timeplan(
      category("A", "Ended", [act("a1", "Ended")]),
      category("B", "Planned", [act("b1", "Planned")]),
    );
    assert.equal(timeplanStatus(plan), TimeplanStatus.Break);
  });

  test("is Break for a missing timeplan", () => {
    assert.equal(timeplanStatus(undefined), TimeplanStatus.Break);
  });

  test("is Warmup before the first act of a category with warm-up time", () => {
    const plan = timeplan(
      category("A", "Started", [act("a1", "Planned"), act("a2", "Planned")]),
    );
    assert.equal(timeplanStatus(plan), TimeplanStatus.Warmup);
  });

  test("is Judging before the first act when there is no warm-up time", () => {
    const plan = timeplan(category("A", "Started", [act("a1", "Planned")], 0));
    assert.equal(timeplanStatus(plan), TimeplanStatus.Judging);
  });

  test("is Act while an act is running", () => {
    const plan = timeplan(
      category("A", "Started", [act("a1", "Ended"), act("a2", "Started")]),
    );
    assert.equal(timeplanStatus(plan), TimeplanStatus.Act);
  });

  test("is Judging between two acts", () => {
    const plan = timeplan(
      category("A", "Started", [act("a1", "Ended"), act("a2", "Planned")]),
    );
    assert.equal(timeplanStatus(plan), TimeplanStatus.Judging);
  });

  test("is Award while a custom entry is running", () => {
    const plan = timeplan(custom("Siegerehrung", "Started"));
    assert.equal(timeplanStatus(plan), TimeplanStatus.Award);
  });

  test("is Break while a category without acts is running", () => {
    const plan = timeplan(category("A", "Started", []));
    assert.equal(timeplanStatus(plan), TimeplanStatus.Break);
  });
});

describe("judging after the last act of a block", () => {
  const now = Date.UTC(2027, 5, 5, 10, 0, 0);
  // The backend writes extended years and nanoseconds.
  const endedAt = (secondsAgo) =>
    `+00${new Date(now - secondsAgo * 1000).toISOString().replace("Z", "000000Z")}`;
  /** Ending its only act ended the block `secondsAgo` seconds before `now`. */
  const endedBlock = (secondsAgo) => ({
    status: "Ended",
    timeplan_entry: {
      Category: {
        name: "KGU15",
        description: "Kleingruppe U15",
        einfahrzeit_seconds: 600,
        judge_duration_seconds: 180,
        acts: [{ ...act("g1", "Ended"), ended_at: endedAt(secondsAgo) }],
      },
    },
  });

  test("is Judging while the act is judged", () => {
    const plan = timeplan(
      endedBlock(4),
      category("B", "Planned", [act("b1", "Planned")]),
    );
    assert.equal(timeplanStatus(plan, now), TimeplanStatus.Judging);
    assert.deepEqual(judgingAfterBlockEnd(plan, now), {
      entry: plan.items[0],
      category: plan.items[0].timeplan_entry.Category,
      act: plan.items[0].timeplan_entry.Category.acts[0],
    });
    assert.equal(
      lastTimeplanAct(plan),
      plan.items[0].timeplan_entry.Category.acts[0],
    );
  });

  test("is Break once the judging time is over", () => {
    const plan = timeplan(endedBlock(180));
    assert.equal(timeplanStatus(plan, now), TimeplanStatus.Break);
    assert.equal(judgingAfterBlockEnd(plan, now), undefined);
    assert.equal(
      timeplanStatus(timeplan(endedBlock(3600)), now),
      TimeplanStatus.Break,
    );
  });

  test("only applies while no entry is running", () => {
    const plan = timeplan(
      endedBlock(4),
      category("B", "Started", [act("b1", "Planned")]),
    );
    assert.equal(judgingAfterBlockEnd(plan, now), undefined);
    assert.equal(timeplanStatus(plan, now), TimeplanStatus.Warmup);
  });

  test("ignores custom entries and acts without an end time", () => {
    assert.equal(
      judgingAfterBlockEnd(
        timeplan(endedBlock(4), custom("Pause", "Ended")),
        now,
      ),
      undefined,
    );
    assert.equal(
      judgingAfterBlockEnd(
        timeplan(category("A", "Ended", [act("a1", "Ended")])),
        now,
      ),
      undefined,
    );
    assert.equal(judgingAfterBlockEnd(undefined, now), undefined);
  });
});

describe("timeplan acts", () => {
  test("currentTimeplanAct returns the running act", () => {
    const running = act("a2", "Started");
    const plan = timeplan(
      category("A", "Started", [act("a1", "Ended"), running]),
    );
    assert.equal(currentTimeplanAct(plan), running);
  });

  test("currentTimeplanAct is undefined during a custom entry", () => {
    const plan = timeplan(custom("Pause", "Started"));
    assert.equal(currentTimeplanAct(plan), undefined);
  });

  test("nextTimeplanAct prefers the next act of the running category", () => {
    const next = act("a2", "Planned");
    const plan = timeplan(
      category("A", "Started", [act("a1", "Started"), next]),
      category("B", "Planned", [act("b1", "Planned")]),
    );
    assert.equal(nextTimeplanAct(plan), next);
  });

  test("nextTimeplanAct falls back to the first act of the next category", () => {
    const next = act("b1", "Planned");
    const plan = timeplan(
      category("A", "Started", [act("a1", "Started")]),
      category("B", "Planned", [next, act("b2", "Planned")]),
    );
    assert.equal(nextTimeplanAct(plan), next);
  });

  test("nextTimeplanAct is undefined when a custom entry comes next", () => {
    const plan = timeplan(
      category("A", "Started", [act("a1", "Started")]),
      custom("Pause", "Planned"),
    );
    assert.equal(nextTimeplanAct(plan), undefined);
  });

  test("lastTimeplanAct prefers the last ended act of the running category", () => {
    const last = act("b2", "Ended");
    const plan = timeplan(
      category("A", "Ended", [act("a1", "Ended")]),
      category("B", "Started", [
        act("b1", "Ended"),
        last,
        act("b3", "Started"),
      ]),
    );
    assert.equal(lastTimeplanAct(plan), last);
  });

  test("lastTimeplanAct falls back to the previous category", () => {
    const last = act("a2", "Ended");
    const plan = timeplan(
      category("A", "Ended", [act("a1", "Ended"), last]),
      category("B", "Started", [act("b1", "Started")]),
    );
    assert.equal(lastTimeplanAct(plan), last);
  });

  test("lastTimeplanAct is undefined when the last ended entry is custom", () => {
    const plan = timeplan(
      category("A", "Ended", [act("a1", "Ended")]),
      custom("Pause", "Ended"),
      custom("Siegerehrung", "Started"),
    );
    assert.equal(lastTimeplanAct(plan), undefined);
  });
});

describe("getStarterPrice", () => {
  const starter = (single_male, single_female, pair) => ({
    single_male,
    single_female,
    pair,
  });
  const competition = { fee_per_start: 15, max_fee_per_starter: 45 };

  test("charges the fee per start", () => {
    assert.equal(getStarterPrice(starter(false, false, false), competition), 0);
    assert.equal(getStarterPrice(starter(false, true, false), competition), 15);
    assert.equal(getStarterPrice(starter(true, false, true), competition), 30);
  });

  test("caps the fee at the maximum", () => {
    const cheap = { fee_per_start: 20, max_fee_per_starter: 35 };
    assert.equal(getStarterPrice(starter(true, false, true), cheap), 35);
    // Three starts at 15 € reach exactly the 45 € cap.
    assert.equal(getStarterPrice(starter(true, true, true), competition), 45);
  });

  test("has no cap without a maximum", () => {
    const uncapped = { fee_per_start: 20, max_fee_per_starter: null };
    assert.equal(getStarterPrice(starter(true, true, true), uncapped), 60);
  });

  test("is free without a competition", () => {
    assert.equal(getStarterPrice(starter(true, false, true), null), 0);
  });

  test("countStarts counts every registered start", () => {
    assert.equal(countStarts(starter(true, false, true)), 2);
  });

  const withGroups = (group_count, ...starts) => ({
    ...starter(...starts),
    group_count,
  });

  test("charges every group membership as a start", () => {
    assert.equal(
      getStarterPrice(withGroups(1, false, false, false), competition),
      15,
    );
    assert.equal(
      getStarterPrice(withGroups(2, false, false, false), competition),
      30,
    );
  });

  test("caps the fee including groups", () => {
    assert.equal(
      getStarterPrice(withGroups(2, true, false, true), competition),
      45,
    );
  });

  test("treats a missing or null group_count as no groups", () => {
    assert.equal(countStarts(withGroups(null, true, false, false)), 1);
    assert.equal(countStarts(withGroups(undefined, true, false, false)), 1);
    assert.equal(countStarts(starter(true, false, false)), 1);
  });

  test("countStarts counts groups", () => {
    assert.equal(countStarts(withGroups(2, false, true, true)), 4);
  });
});

describe("act types and groups", () => {
  test("every act type has a label and a short code", () => {
    assert.deepEqual(actTypeLabels, {
      single: "Einzelkür",
      pair: "Paarkür",
      group_small: "Kleingruppe",
      group_large: "Großgruppe",
    });
    assert.deepEqual(actTypeShort, {
      single: "E",
      pair: "P",
      group_small: "KG",
      group_large: "GG",
    });
  });

  test("isGroupActType", () => {
    assert.equal(isGroupActType("group_small"), true);
    assert.equal(isGroupActType("group_large"), true);
    assert.equal(isGroupActType("single"), false);
    assert.equal(isGroupActType("pair"), false);
    assert.equal(isGroupActType(undefined), false);
  });

  test("groupTypeForSize follows the size limits", () => {
    assert.equal(MIN_GROUP_SIZE, 3);
    assert.equal(MAX_SMALL_GROUP_SIZE, 8);
    assert.equal(groupTypeForSize(0), null);
    assert.equal(groupTypeForSize(2), null);
    assert.equal(groupTypeForSize(3), "group_small");
    assert.equal(groupTypeForSize(8), "group_small");
    assert.equal(groupTypeForSize(9), "group_large");
    assert.equal(groupTypeForSize(20), "group_large");
  });

  test("describeGroup summarizes type, age group and riders", () => {
    assert.equal(describeGroup(7, 1, true), "KG U15 · 7 Fahrer + 1 Ersatz");
    assert.equal(describeGroup(9, 0, false), "GG 15+ · 9 Fahrer");
    assert.equal(describeGroup(3, 0, null), "KG · 3 Fahrer");
  });

  test("describeGroup counts only regular riders for the size", () => {
    assert.equal(describeGroup(8, 2, true), "KG U15 · 8 Fahrer + 2 Ersatz");
  });

  test("describeGroup flags incomplete groups", () => {
    assert.equal(
      describeGroup(2, 3, true),
      "unvollständig – mindestens 3 Fahrer",
    );
    assert.equal(
      describeGroup(0, 0, null),
      "unvollständig – mindestens 3 Fahrer",
    );
  });
});

describe("date formatting", () => {
  test("formats plain dates independent of the time zone", () => {
    assert.equal(formatDate("2027-06-05"), "05.06.2027");
  });

  test("shows a single day once", () => {
    assert.equal(formatDateRange("2027-06-05", "2027-06-05"), "05.06.2027");
  });

  test("shows multi-day competitions as a range", () => {
    assert.equal(
      formatDateRange("2027-06-05", "2027-06-06"),
      "05.06.2027 – 06.06.2027",
    );
  });

  test("reads the backend's extended-year birthdates", () => {
    assert.equal(formatDate("+002012-06-01T00:00:00.000000000Z"), "01.06.2012");
  });
});

describe("registration and music upload windows", () => {
  const competition = {
    registration_start: "2026-12-01T00:00:00+01:00",
    registration_end: "2027-04-30T23:59:59+02:00",
    music_upload_end: "2027-05-15T23:59:59+02:00",
  };
  const at = (value) => Date.parse(value);

  test("registration is open between start and end", () => {
    assert.equal(
      isRegistrationOpen(competition, at("2026-11-30T22:59:59Z")),
      false,
    );
    assert.equal(
      isRegistrationOpen(competition, at("2026-11-30T23:00:00Z")),
      true,
    );
    assert.equal(
      isRegistrationOpen(competition, at("2027-04-30T21:59:59Z")),
      true,
    );
    assert.equal(
      isRegistrationOpen(competition, at("2027-04-30T22:00:00Z")),
      false,
    );
  });

  test("music upload is open until its end", () => {
    assert.equal(
      isMusicUploadOpen(competition, at("2026-01-01T00:00:00Z")),
      true,
    );
    assert.equal(
      isMusicUploadOpen(competition, at("2027-05-15T21:59:59Z")),
      true,
    );
    assert.equal(
      isMusicUploadOpen(competition, at("2027-05-15T22:00:00Z")),
      false,
    );
  });

  test("reads the backend's extended-year timestamps", () => {
    const backend = {
      registration_start: "+002026-11-30T23:00:00Z",
      registration_end: "+002027-04-30T21:59:59.000000000Z",
      music_upload_end: "+002027-05-15T21:59:59.000000000Z",
    };
    const now = at("2027-03-01T12:00:00Z");
    assert.equal(isRegistrationOpen(backend, now), true);
    assert.equal(isMusicUploadOpen(backend, now), true);
  });

  test("everything is closed without a competition", () => {
    assert.equal(isRegistrationOpen(null), false);
    assert.equal(isRegistrationOpen(undefined), false);
    assert.equal(isMusicUploadOpen(null), false);
  });
});

describe("isUnderAge", () => {
  const competition = { determining_day: "2027-06-01" };

  test("counts the 15th birthday on the determining day as 15+", () => {
    assert.equal(isUnderAge(new Date("2012-06-01"), 15, competition), false);
    assert.equal(isUnderAge(new Date("2012-06-02"), 15, competition), true);
  });

  test("handles older and younger riders", () => {
    assert.equal(isUnderAge(new Date("2000-01-01"), 15, competition), false);
    assert.equal(isUnderAge(new Date("2020-01-01"), 15, competition), true);
  });
});

describe("number and time formatting", () => {
  test("formatMoney uses German separators and a euro sign", () => {
    assert.equal(formatMoney(12.5), "12,50\u00a0€");
    assert.equal(formatMoney(1234.5), "1.234,50\u00a0€");
    assert.equal(formatMoney(0), "0,00\u00a0€");
    assert.equal(formatMoney(-5), "-5,00\u00a0€");
  });

  test("formatMoney treats missing amounts as 0 and avoids -0", () => {
    assert.equal(formatMoney(null), "0,00\u00a0€");
    assert.equal(formatMoney(undefined), "0,00\u00a0€");
    assert.equal(formatMoney(-0.001), "0,00\u00a0€");
  });

  test("formatTime shows the local time", () => {
    const local = new Date(2027, 5, 5, 14, 5, 30);
    assert.equal(formatTime(local), "14:05");
    assert.equal(formatTime(local.toISOString()), "14:05");
    assert.equal(formatTime(new Date(2027, 5, 5, 9, 7)), "09:07");
  });

  test("formatTime reads the backend's extended-year timestamps", () => {
    const value = "+002026-10-10T16:17:07.062696483Z";
    assert.equal(
      formatTime(value),
      formatTime(new Date(Date.UTC(2026, 9, 10, 16, 17))),
    );
  });

  test("formatTime and formatDateTime are empty for missing values", () => {
    assert.equal(formatTime(null), "");
    assert.equal(formatTime(undefined), "");
    assert.equal(formatTime("kein Datum"), "");
    assert.equal(formatDateTime(null), "");
  });

  test("formatDateTime shows day, month and time", () => {
    assert.equal(formatDateTime(new Date(2027, 5, 5, 9, 7)), "05.06. 09:07");
  });

  test("formatDuration shows minutes and seconds", () => {
    assert.equal(formatDuration(0), "0:00");
    assert.equal(formatDuration(65), "1:05");
    assert.equal(formatDuration(300), "5:00");
    assert.equal(formatDuration(3725), "1:02:05");
    assert.equal(formatDuration(null), "0:00");
  });

  test("parseDuration reads seconds, m:ss and h:mm:ss", () => {
    assert.equal(parseDuration("150"), 150);
    assert.equal(parseDuration(" 2:30 "), 150);
    assert.equal(parseDuration("0:00"), 0);
    assert.equal(parseDuration("1:02:03"), 3723);
    for (const text of [formatDuration(65), formatDuration(3725)]) {
      assert.equal(formatDuration(parseDuration(text)), text);
    }
  });

  test("parseDuration rejects anything else", () => {
    for (const text of ["", "abc", "1:5", "1:60", "1:60:00", "-5", "1.5"]) {
      assert.equal(parseDuration(text), null, text);
    }
  });

  test("formatAge shows one decimal without rounding up", () => {
    assert.equal(formatAge(14.3), "14,3");
    assert.equal(formatAge(14.96), "14,9");
    assert.equal(formatAge(15), "15,0");
    assert.equal(formatAge(9.04), "9,0");
  });

  test("formatAge is empty for missing ages", () => {
    assert.equal(formatAge(null), "");
    assert.equal(formatAge(undefined), "");
  });
});

describe("act participants", () => {
  const person = (
    id,
    firstname,
    lastname,
    club_name,
    is_replacement = false,
  ) => ({
    id,
    firstname,
    lastname,
    club_name,
    is_replacement,
  });

  const pair = {
    act_type: "pair",
    participants: [
      person("a", "Anna", "Adler", "RSV Köln"),
      person("b", "Ben", "Bär", "SSV Nümbrecht"),
    ],
  };

  const group = {
    act_type: "group_small",
    group_name: "Wirbelwind",
    participants: [
      person("a", "Anna", "Adler", "RSV Köln"),
      person("b", "Ben", "Bär", "SSV Nümbrecht"),
      person("c", "Cleo", "Cobra", "RSV Köln"),
      person("d", "Dana", "Dachs", "RSV Köln", true),
    ],
  };

  test("actParticipantsLabel joins singles and pairs", () => {
    assert.equal(actParticipantsLabel(pair), "Anna Adler & Ben Bär");
    assert.equal(
      actParticipantsLabel({
        ...pair,
        participants: pair.participants.slice(0, 1),
      }),
      "Anna Adler",
    );
  });

  test("actParticipantsLabel shows the group name for groups", () => {
    assert.equal(actParticipantsLabel(group), "Wirbelwind");
  });

  test("actParticipantsLabel falls back to names for unnamed groups", () => {
    assert.equal(
      actParticipantsLabel({
        ...pair,
        act_type: "group_large",
        group_name: null,
      }),
      "Anna Adler & Ben Bär",
    );
  });

  test("actClubNames lists each club once, in participant order", () => {
    assert.deepEqual(actClubNames(group), ["RSV Köln", "SSV Nümbrecht"]);
    assert.deepEqual(actClubNames({ participants: [] }), []);
  });

  test("checkInMap maps starter ids to check-in times", () => {
    const map = checkInMap([
      { starter_id: "a", checked_in_at: "2027-06-05T08:00:00Z" },
      { starter_id: "b", checked_in_at: null },
      { starter_id: "c" },
    ]);
    assert.equal(map.get("a"), "2027-06-05T08:00:00Z");
    assert.equal(map.get("b"), null);
    assert.equal(map.get("c"), null);
  });

  test("checkInStats counts everyone and lists replacements last", () => {
    const checkIns = new Map([
      ["a", "2027-06-05T08:00:00Z"],
      ["b", null],
    ]);
    const stats = checkInStats(
      [group.participants[3], ...group.participants.slice(0, 3)],
      checkIns,
    );
    assert.equal(stats.checkedIn, 1);
    assert.equal(stats.total, 4);
    assert.deepEqual(stats.missingNames, [
      "Ben Bär",
      "Cleo Cobra",
      "Dana Dachs (Ersatz)",
    ]);
    assert.deepEqual(
      stats.missing.map((p) => p.id),
      ["b", "c", "d"],
    );
  });

  test("checkInStats with everyone checked in", () => {
    const checkIns = new Map([
      ["a", "x"],
      ["b", "y"],
    ]);
    assert.deepEqual(checkInStats(pair.participants, checkIns), {
      checkedIn: 2,
      total: 2,
      missing: [],
      missingNames: [],
    });
  });

  test("checkInStats without participants", () => {
    assert.deepEqual(checkInStats([], new Map()), {
      checkedIn: 0,
      total: 0,
      missing: [],
      missingNames: [],
    });
  });
});

describe("errorMessage", () => {
  test("unwraps the Debug formatting of German backend messages", () => {
    assert.equal(
      errorMessage({
        type: "Generic",
        message: '"Der Gruppenname „Wirbelwind“ ist bereits vergeben."',
      }),
      "Der Gruppenname „Wirbelwind“ ist bereits vergeben.",
    );
  });

  test("undoes Debug escapes", () => {
    assert.equal(
      errorMessage({
        type: "Generic",
        message: '"Sag \\"Hallo\\"\\nC:\\\\ \\u{1f600}"',
      }),
      'Sag "Hallo"\nC:\\ \u{1f600}',
    );
  });

  test("keeps other generic messages", () => {
    assert.equal(
      errorMessage({ type: "Generic", message: "Database error: RowNotFound" }),
      "Database error: RowNotFound",
    );
    assert.equal(
      errorMessage({ type: "Generic", message: '""' }),
      "Unbekannter Fehler",
    );
  });

  test("translates status codes and error types", () => {
    assert.equal(
      errorMessage({ type: "StatusCode", message: 403 }),
      "Keine Berechtigung",
    );
    assert.equal(
      errorMessage({ type: "StatusCode", message: 404 }),
      "Nicht gefunden",
    );
    assert.equal(
      errorMessage({ type: "StatusCode", message: 401 }),
      "Nicht angemeldet",
    );
    assert.equal(
      errorMessage({ type: "StatusCode", message: 400 }),
      "Ungültige Anfrage – bitte neu laden",
    );
    assert.equal(
      errorMessage({ type: "StatusCode", message: 422 }),
      "Ungültige Eingabe",
    );
    assert.equal(
      errorMessage({ type: "StatusCode", message: 418 }),
      "Anfrage abgelehnt (418)",
    );
    assert.equal(
      errorMessage({ type: "StatusCode", message: 503 }),
      "Serverfehler (503)",
    );
    assert.equal(
      errorMessage({ type: "InvalidCredentials" }),
      "Nicht angemeldet oder keine Berechtigung",
    );
    assert.equal(errorMessage({ type: "NotFound" }), "Nicht gefunden");
    assert.equal(
      errorMessage({ type: "InternalServerError" }),
      "Interner Serverfehler",
    );
  });

  test("uses the HTTP status for plain-text errors", () => {
    assert.equal(errorMessage("JWT missing", 401), "Nicht angemeldet");
    assert.equal(errorMessage("Admin required", 403), "Keine Berechtigung");
    assert.equal(errorMessage("Etwas anderes"), "Etwas anderes");
    assert.equal(errorMessage("", 500), "Serverfehler (500)");
    assert.equal(errorMessage("", 429), "Anfrage abgelehnt (429)");
    assert.equal(
      errorMessage(
        "Failed to deserialize the JSON body into the target type: x",
        422,
      ),
      "Ungültige Eingabe",
    );
    assert.equal(
      errorMessage(
        "Expected request with `Content-Type: application/json`",
        415,
      ),
      "Ungültige Anfrage",
    );
  });

  test("handles thrown errors", () => {
    assert.equal(errorMessage(new Error("Kaputt")), "Kaputt");
    assert.equal(
      errorMessage(new TypeError("Failed to fetch")),
      "Keine Verbindung zum Server",
    );
  });

  test("reports aborted and timed-out requests as a timeout", () => {
    for (const name of ["TimeoutError", "AbortError"]) {
      assert.equal(
        errorMessage(new DOMException("signal timed out", name)),
        "Zeitüberschreitung – keine Antwort vom Server",
      );
    }
  });

  test("falls back to a generic message", () => {
    assert.equal(errorMessage(undefined), "Unbekannter Fehler");
    assert.equal(errorMessage(null), "Unbekannter Fehler");
    assert.equal(errorMessage({}), "Unbekannter Fehler");
  });
});

describe("unwrap", () => {
  // The parts of a fetch Response that unwrap reads.
  const response = (status) => ({ ok: status >= 200 && status < 300, status });

  test("returns the data of a successful response", () => {
    const data = [{ id: 1 }];
    assert.equal(unwrap({ data, response: response(200) }), data);
    assert.equal(unwrap({ data }), data);
  });

  test("throws an ApiError with a German message", () => {
    assert.throws(
      () =>
        unwrap({
          error: { type: "StatusCode", message: 403 },
          response: response(403),
        }),
      (error) =>
        error instanceof ApiError &&
        error instanceof Error &&
        error.message === "Keine Berechtigung" &&
        error.status === 403,
    );
  });

  test("throws for failed responses without a body", () => {
    assert.throws(
      () =>
        unwrap({
          error: undefined,
          response: response(404),
        }),
      { message: "Nicht gefunden" },
    );
  });
});
