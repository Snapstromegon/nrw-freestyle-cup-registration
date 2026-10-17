import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  actOfType,
  ageOnDeterminingDay,
  clubIssues,
  formatEuro,
  hasStart,
  isPendingPair,
  isStepId,
  paymentState,
  stepSummaries,
} from "../src/ts/club-data.ts";

const CLUB = "club-1";
const competition = {
  determining_day: "2027-06-01",
  fee_per_start: 15,
  max_fee_per_starter: 45,
};

const starter = (id, fields = {}) => ({
  id,
  club_id: CLUB,
  firstname: id,
  lastname: "Muster",
  birthdate: "2015-03-01T00:00:00Z",
  single_male: false,
  single_female: false,
  pair: false,
  partner_name: null,
  partner_id: null,
  group_count: 0,
  waived_count: 0,
  ...fields,
});

const participant = (id, fields = {}) => ({
  id,
  club_id: CLUB,
  club_name: "RSV",
  starter_firstname: id,
  starter_lastname: "Muster",
  is_replacement: false,
  ...fields,
});

const act = (id, act_type, participants, fields = {}) => ({
  id,
  act_type,
  name: "Titel",
  created_at: "2026-01-01T00:00:00Z",
  fee_waived: false,
  withdrawn: false,
  participants,
  song_file: "song.mp3",
  owner_club_id: act_type.startsWith("group") ? CLUB : null,
  ...fields,
});

const group = (id, members, fields = {}) => ({
  id,
  act_type: "group_small",
  group_name: id,
  name: "",
  is_owner: true,
  owner_club_id: CLUB,
  members: members.map((m) => ({
    starter_id: m,
    club_id: CLUB,
    club_name: "RSV",
    firstname: m,
    lastname: "Muster",
    is_replacement: false,
  })),
  ...fields,
});

const data = (fields = {}) => ({
  club: { id: CLUB, name: "RSV", code: "RS-1", owner_id: "u", payment: 0 },
  starters: [],
  acts: [],
  groups: [],
  allGroups: [],
  ...fields,
});

describe("club data", () => {
  test("isStepId accepts the four steps only", () => {
    assert.ok(isStepId("fahrer"));
    assert.ok(!isStepId("zuordnung"));
    assert.ok(isStepId("startgeld"));
    assert.ok(!isStepId("admin"));
  });

  test("hasStart and pending pairs", () => {
    assert.ok(!hasStart(starter("a")));
    assert.ok(hasStart(starter("a", { group_count: 1 })));
    assert.ok(isPendingPair(starter("a", { pair: true, partner_name: "X" })));
    assert.ok(!isPendingPair(starter("a", { pair: true, partner_id: "b" })));
  });

  test("actOfType finds a starter's single", () => {
    const acts = [act("s", "single", [participant("a")])];
    assert.equal(actOfType(acts, "a", "single")?.id, "s");
    assert.equal(actOfType(acts, "a", "pair"), undefined);
  });

  test("paymentState caps fees and subtracts payments", () => {
    const d = data({
      club: { id: CLUB, name: "RSV", code: "X", owner_id: "u", payment: 20 },
      starters: [
        starter("a", { single_female: true, pair: true, group_count: 2 }),
        starter("b", { single_male: true }),
      ],
    });
    assert.deepEqual(paymentState(d, competition), {
      amount: 60,
      paid: 20,
      open: 40,
    });
  });

  test("clubIssues reports riders without act, incomplete groups and missing music", () => {
    const d = data({
      starters: [starter("a", { group_count: 1 }), starter("b")],
      acts: [act("g", "group_small", [participant("a")], { song_file: null })],
      groups: [group("g", ["a"])],
    });
    const issues = clubIssues(d, competition);
    assert.equal(issues[0].level, "error");
    assert.match(issues[0].text, /unvollständig/);
    assert.ok(issues.some((i) => i.target === "b" && i.step === "kueren"));
    assert.ok(issues.some((i) => /ohne Musik/.test(i.text)));
    assert.ok(issues.some((i) => i.step === "startgeld"));
  });

  test("clubIssues skips missing music once uploads are closed", () => {
    const d = data({
      starters: [starter("a", { single_female: true })],
      acts: [act("s", "single", [participant("a")], { song_file: null })],
    });
    assert.ok(
      !clubIssues(d, competition, { musicOpen: false }).some((i) =>
        /Musik/.test(i.text),
      ),
    );
  });

  test("clubIssues ignores music of other clubs' groups", () => {
    const d = data({
      club: { id: CLUB, name: "RSV", code: "X", owner_id: "u", payment: 15 },
      starters: [starter("a", { group_count: 1 })],
      acts: [
        act("g", "group_small", [participant("a")], {
          song_file: null,
          owner_club_id: "other",
        }),
      ],
      groups: [group("g", ["a", "x", "y"], { is_owner: false })],
    });
    assert.deepEqual(clubIssues(d, competition), []);
  });

  test("stepSummaries marks finished steps", () => {
    const d = data({
      club: { id: CLUB, name: "RSV", code: "X", owner_id: "u", payment: 15 },
      starters: [starter("a", { single_female: true })],
      acts: [act("s", "single", [participant("a")])],
    });
    const summaries = stepSummaries(d, competition, clubIssues(d, competition));
    assert.equal(summaries.fahrer.state, "done");
    assert.equal(summaries.kueren.state, "done");
    assert.equal(summaries.startgeld.state, "done");
    assert.equal(summaries.kueren.summary, "1 Kür");
  });

  test("stepSummaries counts open points of the acts step", () => {
    const d = data({
      starters: [starter("a", { group_count: 1 }), starter("b")],
      acts: [act("g", "group_small", [participant("a")])],
      groups: [group("g", ["a"])],
    });
    const summaries = stepSummaries(d, competition, clubIssues(d, competition));
    assert.equal(summaries.kueren.state, "open");
    assert.equal(summaries.kueren.summary, "1 Kür · 2 offen");
  });

  test("stepSummaries counts a pending pair as an act", () => {
    const d = data({
      starters: [starter("a", { pair: true, partner_name: "X Y" })],
    });
    const summaries = stepSummaries(d, competition, clubIssues(d, competition));
    assert.equal(summaries.kueren.summary, "1 Kür");
  });

  test("ageOnDeterminingDay counts whole years", () => {
    assert.equal(ageOnDeterminingDay("2012-06-01T00:00:00Z", competition), 15);
    assert.equal(ageOnDeterminingDay("2012-06-02T00:00:00Z", competition), 14);
  });

  test("formatEuro drops cents for whole amounts", () => {
    assert.equal(formatEuro(135), "135 €");
    assert.equal(formatEuro(12.5), "12,50 €");
  });
});
