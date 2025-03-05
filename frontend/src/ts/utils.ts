import { components } from "./bindings";

export enum TimeplanStatus {
  Break = "Break",
  Warmup = "Warmup",
  Act = "Act",
  Judging = "Judging",
  Award = "Award",
}

export const timeplanStatus = (
  timeplan: components["schemas"]["Timeplan"]
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
    if(entry.timeplan_entry.Category.acts[0].status === "Planned") {
      return TimeplanStatus.Warmup;
    }
    return TimeplanStatus.Judging;
  }
  return TimeplanStatus.Award;
}

export const currentTimeplanEntry = (
  timeplan: components["schemas"]["Timeplan"]
) => {
  return timeplan?.items.find((item) => item.status === "Started");
};

export const nextTimeplanEntry = (
  timeplan: components["schemas"]["Timeplan"]
) => {
  return timeplan?.items.find(
    (item) => item.status === "Planned"
  );
};
export const lastTimeplanEntry = (
  timeplan: components["schemas"]["Timeplan"]
) => {
  return timeplan?.items.findLast(
    (item) => item.status === "Ended"
  );
};

export const currentTimeplanAct = (
  timeplan: components["schemas"]["Timeplan"]
) => {
  const entry = currentTimeplanEntry(timeplan);
  if (!entry || !("Category" in entry.timeplan_entry)) {
    return undefined;
  }
  return entry.timeplan_entry.Category.acts.find(
    (act) => act.status == "Started"
  );
};

export const nextTimeplanAct = (
  timeplan: components["schemas"]["Timeplan"]
) => {
  const currentEntry = currentTimeplanEntry(timeplan);
  if (currentEntry && "Category" in currentEntry.timeplan_entry) {
    const act = currentEntry.timeplan_entry.Category.acts.find(
      (act) => act.status == "Planned"
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
    (act) => act.status == "Planned"
  );
}

export const lastTimeplanAct = (
  timeplan: components["schemas"]["Timeplan"]
) => {

  const currentEntry = currentTimeplanEntry(timeplan);
  if (currentEntry && ("Category" in currentEntry.timeplan_entry)) {
    const act = currentEntry.timeplan_entry.Category.acts.findLast(
      (act) => act.status == "Ended"
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
    (act) => act.status == "Ended"
  );
};
