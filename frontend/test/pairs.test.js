import assert from "node:assert/strict";
import { describe, test } from "vite-plus/test";
import {
  editDistance,
  normalizeName,
  pairCandidates,
  unconfirmedPairs,
} from "../src/ts/pairs.ts";

const starter = (id, club, firstname, lastname, fields = {}) => ({
  id,
  club_id: club,
  club_name: club,
  firstname,
  lastname,
  birthdate: "2010-01-01T00:00:00Z",
  age_on_competition: 17,
  single_male: false,
  single_female: false,
  pair: true,
  partner_id: null,
  partner_name: null,
  group_count: 0,
  waived_count: 0,
  ...fields,
});

describe("pairs", () => {
  test("normalizeName ignores case, accents and umlaut spellings", () => {
    assert.equal(normalizeName("Paul Krämer"), normalizeName("paul kraemer"));
    assert.equal(normalizeName("  Jörg  Groß "), "jorg gross");
    assert.equal(normalizeName("Zoé"), "zoe");
  });

  test("editDistance", () => {
    assert.equal(editDistance("kramer", "kramer"), 0);
    assert.equal(editDistance("neumann", "naumann"), 1);
    assert.equal(editDistance("", "abc"), 3);
  });

  test("mutual exact names come first and are listed once", () => {
    const laura = starter("l", "koeln", "Laura", "Schulz", {
      partner_name: "Clara Berg",
    });
    const clara = starter("c", "bonn", "Clara", "Berg", {
      partner_name: "Laura Schulz",
    });
    const other = starter("o", "bonn", "Clara", "Bergmann", {
      partner_name: "X Y",
    });
    assert.equal(
      pairCandidates(laura, [laura, clara, other])[0].match,
      "mutual",
    );
    const pairs = unconfirmedPairs([laura, clara, other]);
    assert.deepEqual(
      pairs.map((p) => [p.starter.id, p.partner?.starter.id ?? null]),
      [
        ["c", "l"],
        ["o", null],
      ],
    );
  });

  test("similar spellings are suggested", () => {
    const paul = starter("p", "koeln", "Paul", "Krämer", {
      partner_name: "Ida Neumann",
    });
    const ida = starter("i", "bonn", "Ida", "Naumann", {
      partner_name: "Paul Kramer",
    });
    const [candidate] = pairCandidates(paul, [paul, ida]);
    assert.equal(candidate.starter.id, "i");
    assert.equal(candidate.match, "exact"); // "Paul Kramer" = "Paul Krämer"
    assert.equal(unconfirmedPairs([paul, ida]).length, 1);
  });

  test("riders of the same club, linked riders and strangers aren't suggested", () => {
    const a = starter("a", "x", "Anna", "Alpha", {
      partner_name: "Berta Beta",
    });
    const sameClub = starter("b", "x", "Berta", "Beta");
    const linked = starter("c", "y", "Berta", "Beta", { partner_id: "z" });
    const stranger = starter("d", "y", "Doris", "Delta");
    assert.deepEqual(pairCandidates(a, [a, sameClub, linked, stranger]), []);
  });
});
