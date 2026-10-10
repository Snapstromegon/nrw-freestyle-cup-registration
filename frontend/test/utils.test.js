import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  currentTimeplanAct,
  currentTimeplanEntry,
  lastTimeplanAct,
  lastTimeplanEntry,
  nextTimeplanAct,
  nextTimeplanEntry,
  TimeplanStatus,
  timeplanStatus,
} from "../src/ts/utils.ts";

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

  test("handles a running category without acts", {
    todo: "known bug: timeplanStatus reads acts[0].status without checking for an empty category",
  }, () => {
    const plan = timeplan(category("A", "Started", []));
    assert.doesNotThrow(() => timeplanStatus(plan));
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
