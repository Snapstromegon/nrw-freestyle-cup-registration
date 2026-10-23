import assert from "node:assert/strict";
import { describe, test } from "vite-plus/test";
import {
  ageOnStart,
  coverage,
  isJudgeRegistrationOpen,
  judgeRegistrationEnd,
} from "../src/ts/jury.ts";

const competition = (jury) => ({
  registration_start: "2026-11-20T00:00:00+01:00",
  registration_end: "2026-12-20T23:59:59+01:00",
  jury,
});

const rules = (registration_end = null) => ({
  min_age: 15,
  deployments_per_two_acts: 4,
  missing_deployment_fee: 7,
  registration_end,
});

describe("jury", () => {
  test("the judge registration ends with the registration by default", () => {
    assert.equal(
      judgeRegistrationEnd(competition(rules())),
      "2026-12-20T23:59:59+01:00",
    );
    assert.equal(
      judgeRegistrationEnd(competition(rules("2027-01-10T23:59:59+01:00"))),
      "2027-01-10T23:59:59+01:00",
    );
    assert.equal(judgeRegistrationEnd(null), null);
  });

  test("isJudgeRegistrationOpen follows its own deadline", () => {
    const after = Date.parse("2026-12-24T12:00:00+01:00");
    assert.ok(!isJudgeRegistrationOpen(competition(rules()), after));
    assert.ok(
      isJudgeRegistrationOpen(
        competition(rules("2027-01-10T23:59:59+01:00")),
        after,
      ),
    );
    const before = Date.parse("2026-11-01T12:00:00+01:00");
    assert.ok(!isJudgeRegistrationOpen(competition(rules()), before));
    assert.ok(!isJudgeRegistrationOpen(null, after));
  });

  test("ageOnStart counts whole years on the first competition day", () => {
    const start = { start_date: "2027-06-05" };
    assert.equal(ageOnStart("2012-06-05T00:00:00.000Z", start), 15);
    assert.equal(ageOnStart("2012-06-06T00:00:00.000Z", start), 14);
    assert.equal(ageOnStart("2012-06-06T00:00:00.000Z", null), null);
  });

  test("coverage counts trained and untrained judges per category and role", () => {
    const start = { start_date: "2027-06-05" };
    const judge = (birthdate, is_trained, registrations) => ({
      birthdate,
      is_trained,
      registrations: registrations.map(([jury_category_id, role]) => ({
        jury_category_id,
        role,
      })),
    });
    const judges = [
      judge("1990-01-01T00:00:00.000Z", true, [
        ["a", "technical"],
        ["a", "performance"],
        ["b", "technical"],
      ]),
      // 15 on the first day.
      judge("2012-01-01T00:00:00.000Z", true, [["a", "technical"]]),
      judge("2014-01-01T00:00:00.000Z", false, [["a", "dismounts"]]),
    ];
    const result = coverage(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      judges,
      start,
    );
    assert.deepEqual(result.get("a"), {
      technical: { trained: 2, untrained: 0 },
      performance: { trained: 1, untrained: 0 },
      dismounts: { trained: 0, untrained: 1 },
      fifteen: 1,
    });
    assert.deepEqual(result.get("b").technical, { trained: 1, untrained: 0 });
    assert.equal(result.get("c").fifteen, 0);
  });
});
