// Unconfirmed pairs across clubs: a pair rider whose partner rides for
// another club isn't linked until an admin confirms it. These helpers find
// the likely partner by the names the clubs entered. Only type imports, so
// the unit tests can import it without a DOM.
import type { components } from "./bindings";

type Starter = components["schemas"]["Starter"];

/** A name for comparing: lower case, without accents, ß → ss, ä → a. */
export const normalizeName = (name: string) =>
  name
    .toLocaleLowerCase("de")
    .replaceAll("ß", "ss")
    .replace(/(?<=[aou])e/g, "") // "ae" → "a", as "ä" becomes "a" below
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Edit distance of two strings (insertions, deletions, substitutions). */
export const editDistance = (a: string, b: string) => {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
};

const fullName = (s: Pick<Starter, "firstname" | "lastname">) =>
  `${s.firstname} ${s.lastname}`;

/** How well a name matches: 0 exact, 1 similar, `null` not at all. */
const nameMatch = (wanted: string | null | undefined, name: string) => {
  if (!wanted) {
    return null;
  }
  const a = normalizeName(wanted);
  const b = normalizeName(name);
  if (a === b) {
    return 0;
  }
  // Up to two typos, but not for very short names.
  return Math.min(a.length, b.length) >= 6 && editDistance(a, b) <= 2
    ? 1
    : null;
};

/** Whether a rider waits for a partner of another club. */
export const isUnconfirmedPair = (s: Starter) => s.pair && !s.partner_id;

export interface PairCandidate {
  starter: Starter;
  /**
   * "mutual": both name each other exactly. "exact": the name matches one
   * way. "similar": the names are spelled a bit differently.
   */
  match: "mutual" | "exact" | "similar";
}

/** The unconfirmed riders of other clubs, best match first. */
export const pairCandidates = (
  starter: Starter,
  starters: Starter[],
): PairCandidate[] => {
  const ranked: (PairCandidate & { score: number })[] = [];
  for (const other of starters) {
    if (other.club_id === starter.club_id || !isUnconfirmedPair(other)) {
      continue;
    }
    const there = nameMatch(starter.partner_name, fullName(other));
    const back = nameMatch(other.partner_name, fullName(starter));
    if (there === null && back === null) {
      continue;
    }
    const match =
      there === 0 && back === 0
        ? "mutual"
        : there === 0 || back === 0
          ? "exact"
          : "similar";
    ranked.push({
      starter: other,
      match,
      score: (there ?? 2) + (back ?? 2),
    });
  }
  return ranked
    .sort((a, b) => a.score - b.score)
    .map(({ starter, match }) => ({ starter, match }));
};

export interface UnconfirmedPair {
  starter: Starter;
  /** The likely partner, if any; the other options in `candidates`. */
  partner: PairCandidate | null;
  candidates: PairCandidate[];
}

/**
 * Every unconfirmed pair rider, sorted by name. Riders who are each other's
 * best match are listed once, as one pair.
 */
export const unconfirmedPairs = (starters: Starter[]): UnconfirmedPair[] => {
  const waiting = starters
    .filter(isUnconfirmedPair)
    .sort((a, b) =>
      `${a.lastname} ${a.firstname}`.localeCompare(
        `${b.lastname} ${b.firstname}`,
        "de",
      ),
    );
  const listed = new Set<string>();
  const pairs: UnconfirmedPair[] = [];
  for (const starter of waiting) {
    if (listed.has(starter.id)) {
      continue;
    }
    const candidates = pairCandidates(starter, starters);
    const partner = candidates[0] ?? null;
    listed.add(starter.id);
    if (
      partner &&
      pairCandidates(partner.starter, starters)[0]?.starter.id === starter.id
    ) {
      listed.add(partner.starter.id);
    }
    pairs.push({ starter, partner, candidates });
  }
  return pairs;
};
