import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { liveState, phaseTimer, scheduleOffset } from "../src/ts/live.ts";

const START = "2027-02-12T09:00:00Z";
const MINUTE = 60_000;

/** A running category block with one act, started at 09:00. */
const timeplan = (act) => ({
  offset: 0,
  items: [
    {
      status: "Started",
      started_at: START,
      ended_at: null,
      predicted_start: START,
      predicted_end: START,
      planned_start: START,
      planned_end: START,
      planned_duration: 0,
      timeplan_entry: {
        Category: {
          name: "EMU13",
          description: "Einzel Männlich U13",
          duration_seconds: 600,
          order: 1,
          einfahrzeit_seconds: 0,
          warmup_seconds: 0,
          act_duration_seconds: 180,
          judge_duration_seconds: 120,
          acts: [
            {
              id: "a",
              name: "Dschungelbuch",
              status: "Started",
              started_at: START,
              ended_at: null,
              predicted_start: START,
              predicted_end: START,
              planned_start: START,
              planned_end: START,
              ...act,
            },
          ],
        },
      },
    },
  ],
});

describe("scheduleOffset", () => {
  test("words and colours the delay", () => {
    assert.deepEqual(scheduleOffset(0), {
      label: "im Plan",
      value: "0:00",
      tone: "ok",
    });
    assert.deepEqual(scheduleOffset(-190), {
      label: "Vorsprung",
      value: "3:10",
      tone: "ok",
    });
    assert.equal(scheduleOffset(15 * 60).tone, "warn");
    assert.deepEqual(scheduleOffset(15 * 60 + 1), {
      label: "Verzug",
      value: "15:01",
      tone: "bad",
    });
  });
});

describe("phaseTimer", () => {
  const now = Date.parse(START) + 2 * MINUTE;

  test("an act's time waits for its music", () => {
    const live = liveState(timeplan({ music_started_at: null }), now);
    assert.equal(live.phase, "act");
    assert.deepEqual(phaseTimer(live, now, true), {
      waiting: true,
      elapsed: 0,
      planned: 180,
    });
    // Without music it runs from the act's start.
    assert.deepEqual(phaseTimer(live, now, false), {
      waiting: false,
      elapsed: 120,
      planned: 180,
    });
  });

  test("and then runs from the music's start", () => {
    const musicStart = new Date(Date.parse(START) + 0.5 * MINUTE);
    const live = liveState(
      timeplan({ music_started_at: musicStart.toISOString() }),
      now,
    );
    assert.deepEqual(phaseTimer(live, now, true), {
      waiting: false,
      elapsed: 90,
      planned: 180,
    });
  });

  test("is undefined without a start", () => {
    assert.equal(phaseTimer({ phase: "before" }, Date.now(), false), undefined);
  });
});
