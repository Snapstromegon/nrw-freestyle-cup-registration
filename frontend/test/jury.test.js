import assert from "node:assert/strict";
import { describe, test } from "vite-plus/test";
import {
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
});
