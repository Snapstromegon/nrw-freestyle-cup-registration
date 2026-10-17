import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { errorMessage } from "../../../api";
import {
  type ClubAct,
  type ClubData,
  type ClubGroup,
  type ClubStarter,
  riderCounts,
} from "../../../club-data";
import { iconStyles, resetStyles } from "../../../styles/base";
import { clubPortalStyles } from "../../../styles/club-portal";
import {
  actTypeLabels,
  groupSizeWarning,
  MIN_GROUP_SIZE,
} from "../../../utils";
import {
  editStarter,
  genderLabels,
  hasSingle,
  leavePair,
  linkPartners,
  ownGroupMembers,
  pairWithOtherClub,
  replaceRider,
  setGroupMembers,
} from "./club-actions";
import "../cup-rider-picker.js";
import { dataChanged } from "./events";
import { type Rider, riderOptions, ridersOf } from "./riders";

/**
 * Picks the riders of one act: the rider of a single, both riders of a pair
 * (or a pair waiting for its partner of another club, `pending`), the riders
 * of a group. Every change is saved right away; singles and pairs keep their
 * title and music when their riders change. The pickers only offer riders
 * who are free for the act. Admins can also connect a waiting pair with a
 * rider of another club, change a pair's partner of another club and manage
 * other clubs' riders in groups.
 */
@customElement("cup-club-act-riders")
export default class CupClubActRiders extends LitElement {
  static override styles = [
    resetStyles,
    iconStyles,
    clubPortalStyles,
    css`
      :host {
        display: block;
      }

      .slots {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
      }

      .busy {
        opacity: 0.5;
        pointer-events: none;
      }

      input[type="text"],
      cup-rider-picker {
        width: 16rem;
        max-width: 100%;
      }

      cup-rider-picker.add {
        --picker-placeholder: var(--cup-blue);
      }

      .and {
        color: var(--cup-muted);
      }

      .fixed {
        padding: 0.4rem 0.5rem;
        border: 1px dashed var(--cup-border);
        border-radius: 0.375rem;
        color: var(--cup-muted);
      }

      .member {
        display: inline-flex;
        align-items: center;
        gap: 0.125rem;
        padding: 0.125rem 0.125rem 0.125rem 0.625rem;
        border-radius: 100vh;
        border: 1px solid var(--cup-border);
        background: var(--cup-surface-2);
        font-size: 0.9rem;
      }

      .member.other {
        padding-right: 0.625rem;
        border-style: dashed;
        background: none;
        color: var(--cup-muted);
      }

      .member.replacement {
        border-color: var(--cup-amber);
      }

      .member.conflict {
        border-color: var(--cup-red);
      }

      .member .repl {
        margin-left: 0.25rem;
        padding: 0 0.375rem;
        border: 1px solid var(--cup-border);
        border-radius: 100vh;
        background: var(--cup-surface);
        color: var(--cup-muted);
        font: inherit;
        font-size: 0.7rem;
        font-weight: 700;
        cursor: pointer;
      }

      .member .repl[aria-pressed="true"] {
        background: var(--cup-amber);
        border-color: var(--cup-amber);
        color: #fff;
      }

      .member .icon-btn {
        font-size: 16px;
      }

      .note {
        margin-top: 0.375rem;
        font-size: 0.8rem;
        color: var(--cup-muted);
      }

      .note.error {
        color: var(--cup-red);
      }

      .note.warn {
        color: var(--cup-amber);
      }

      .banner {
        margin: 0.5rem 0 0;
      }

      @media (max-width: 720px) {
        input[type="text"],
        cup-rider-picker {
          flex: 1 1 100%;
          width: auto;
          min-width: 0;
        }
      }
    `,
  ];

  @property({ attribute: false }) data!: ClubData;
  @property({ attribute: false }) act?: ClubAct;
  @property({ attribute: false }) group?: ClubGroup;
  /** A pair waiting for its partner of another club: it has no act yet. */
  @property({ attribute: false }) pending?: ClubStarter;
  @property({ type: Boolean, attribute: "can-register" }) canRegister = false;
  /** Admins connect pairs and fill groups with riders of any club. */
  @property({ type: Boolean }) admin = false;

  @state() busy = false;
  @state() error: string | null = null;
  @state() warning: string | null = null;

  /** The club's riders and, for admins, those of all clubs. */
  get riders() {
    return ridersOf(this.data, this.admin);
  }

  /** Only the club's riders: singles and pairs keep to their club. */
  get ownRiders() {
    return ridersOf(this.data, false);
  }

  override render() {
    let slots;
    let note = nothing as unknown;
    if (this.pending) {
      slots = this.renderPendingSlots(this.pending);
      note = html`<p class="note warn">
        ⌛ Der Veranstalter verbindet das Paar, sobald der andere Verein
        ${this.pending.partner_name || "den Partner"} mit eurem Fahrer als
        Partner angemeldet hat.
      </p>`;
    } else if (this.act?.act_type === "single") {
      slots = this.renderSingleSlot(this.act);
    } else if (this.act?.act_type === "pair") {
      slots = this.renderPairSlots(this.act);
    } else if (this.group) {
      slots = this.renderGroupSlots(this.group);
      note = this.renderGroupNote(this.group);
    } else {
      slots = html`<span class="muted">Lädt…</span>`;
    }
    return html`<div class=${classMap({ slots: true, busy: this.busy })}>
        ${slots}
      </div>
      ${note}
      ${this.renderMessage("error", this.error)}
      ${this.renderMessage("warn", this.warning)}`;
  }

  renderMessage(level: "error" | "warn", text: string | null) {
    if (!text) {
      return nothing;
    }
    return html`<p class="banner ${level}" role="alert">
      <i class="material-icon">${level === "error" ? "error" : "warning"}</i>
      <span class="grow">${text}</span>
      <button
        class="icon-btn"
        title="Schließen"
        aria-label="Schließen"
        @click=${level === "error" ? this.clearError : this.clearWarning}
      >
        close
      </button>
    </p>`;
  }

  renderGroupNote(group: ClubGroup) {
    const { regular } = riderCounts(group.members);
    if (regular < MIN_GROUP_SIZE) {
      return html`<p class="note error">
        Unvollständig: mindestens ${MIN_GROUP_SIZE} Fahrer (ohne Ersatz) nötig.
      </p>`;
    }
    if (group.conflict) {
      return html`<p class="note error">${group.conflict}</p>`;
    }
    const warning = groupSizeWarning(group.act_type, regular);
    return warning
      ? html`<p class="note warn">
          ${actTypeLabels[group.act_type]}: ${warning}.
        </p>`
      : nothing;
  }

  renderSingleSlot(act: ClubAct) {
    const current = act.participants[0];
    // Free for a single: no single yet, and a gender to rate it by.
    const riders = this.ownRiders.filter(
      (r) => r.id === current?.id || (!hasSingle(r) && !!r.gender),
    );
    return html`<cup-rider-picker
      label="Fahrer der Einzelkür ${act.name}"
      .options=${riderOptions(this.data, riders, (r) =>
        r.gender ? genderLabels[r.gender] : "",
      )}
      .value=${current?.id ?? ""}
      ?disabled=${!this.canRegister || act.withdrawn || !current}
      @change=${
        // eslint-disable-next-line lit/no-template-arrow
        (e: CustomEvent<{ value: string }>) =>
          current && this.replace(act, current.id, e.detail.value)
      }
    ></cup-rider-picker>`;
  }

  renderPairSlots(act: ClubAct) {
    const slots = act.participants.map((p) => {
      const own = p.club_id === this.data.club.id;
      // The partner of another club: only admins change it, with a rider of
      // any club (like connecting a pair).
      if (!own && !this.admin) {
        return html`<span class="fixed"
          >${p.starter_firstname} ${p.starter_lastname} (${p.club_name})</span
        >`;
      }
      const other = act.participants.find((o) => o.id !== p.id);
      // Free for a pair: in no pair, not even one waiting for a partner.
      const riders = (own ? this.ownRiders : this.riders).filter(
        (r) =>
          r.id === p.id || (r.id !== other?.id && !r.pair && !r.partner_id),
      );
      return html`<cup-rider-picker
        label="Fahrer der Paarkür ${act.name}"
        .options=${riderOptions(this.data, riders)}
        .value=${p.id}
        ?disabled=${!this.canRegister || act.withdrawn}
        @change=${
          // eslint-disable-next-line lit/no-template-arrow
          (e: CustomEvent<{ value: string }>) =>
            this.replace(act, p.id, e.detail.value)
        }
      ></cup-rider-picker>`;
    });
    return html`${slots[0]}<span class="and">&</span>${slots[1] ?? nothing}`;
  }

  renderPendingSlots(starter: ClubStarter) {
    const own = this.ownRiders.filter((r) => r.id === starter.id || !r.pair);
    // The partner: a free rider of the club, or for admins any rider
    // without a linked partner (e.g. one waiting in another club).
    const partners = this.riders.filter(
      (r) =>
        r.id !== starter.id &&
        !r.partner_id &&
        (r.club_id === this.data.club.id ? !r.pair : this.admin),
    );
    return html`<cup-rider-picker
        label="Eigener Fahrer der Paarkür"
        .options=${riderOptions(this.data, own)}
        .value=${starter.id}
        ?disabled=${!this.canRegister}
        @change=${
          // eslint-disable-next-line lit/no-template-arrow
          (e: CustomEvent<{ value: string }>) =>
            this.replacePendingRider(starter, e.detail.value)
        }
      ></cup-rider-picker>
      <span class="and">&</span>
      <input
        type="text"
        aria-label="Partner aus anderem Verein"
        placeholder="Name des Partners"
        .value=${starter.partner_name ?? ""}
        ?disabled=${!this.canRegister}
        @change=${
          // eslint-disable-next-line lit/no-template-arrow
          (e: Event) => this.renamePendingPartner(starter, e)
        }
      />
      ${
        this.canRegister && partners.length
          ? html`<cup-rider-picker
              class="add"
              label=${this.admin ? "Partner verbinden" : "Stattdessen mit eigenem Fahrer paaren"}
              placeholder=${this.admin ? "Partner verbinden…" : "Oder eigener Fahrer…"}
              .options=${riderOptions(this.data, partners, (r) =>
                r.partner_name ? `– nennt ${r.partner_name}` : "",
              )}
              @change=${
                // eslint-disable-next-line lit/no-template-arrow
                (e: CustomEvent<{ value: string }>) =>
                  this.pairPending(starter, e.detail.value)
              }
            ></cup-rider-picker>`
          : nothing
      }`;
  }

  renderGroupSlots(group: ClubGroup) {
    const clubId = this.data.club.id;
    // A rider may start in one small and one large group.
    const elsewhere = new Map<string, string>();
    for (const other of this.data.groups) {
      if (other.id !== group.id && other.act_type === group.act_type) {
        for (const m of other.members) {
          elsewhere.set(m.starter_id, other.group_name);
        }
      }
    }
    const members = group.members.map((m) => {
      const name = `${m.firstname} ${m.lastname}`;
      const own = m.club_id === clubId;
      if (!own && !this.admin) {
        return html`<span class="member other" title=${m.club_name}
          >${name} (${m.club_name})${m.is_replacement ? " · Ersatz" : ""}</span
        >`;
      }
      const conflict = elsewhere.get(m.starter_id);
      return html`<span
        class=${classMap({
          member: true,
          replacement: m.is_replacement,
          conflict: !!conflict,
        })}
        title=${conflict ? `Auch in „${conflict}“` : ""}
      >
        ${name}${own ? nothing : html` <span class="muted">(${m.club_name})</span>`}
        <button
          class="repl"
          aria-pressed=${m.is_replacement ? "true" : "false"}
          title=${
            m.is_replacement
              ? "Ersatzfahrer – klicken für regulär"
              : "Als Ersatzfahrer markieren"
          }
          aria-label="${name} als Ersatz"
          ?disabled=${!this.canRegister}
          @click=${
            // eslint-disable-next-line lit/no-template-arrow
            () =>
              this.setMember(group, m.starter_id, m.club_id, !m.is_replacement)
          }
        >
          E
        </button>
        ${
          this.canRegister
            ? html`<button
                class="icon-btn danger"
                title="Entfernen"
                aria-label="${name} aus ${group.group_name} entfernen"
                @click=${
                  // eslint-disable-next-line lit/no-template-arrow
                  () => this.setMember(group, m.starter_id, m.club_id, null)
                }
              >
                close
              </button>`
            : nothing
        }
      </span>`;
    });
    const candidates = this.riders.filter(
      (r) => !group.members.some((m) => m.starter_id === r.id),
    );
    return html`${
      members.length
        ? members
        : html`<span class="muted">Noch keine Fahrer.</span>`
    }
    ${
      this.canRegister && candidates.length
        ? html`<cup-rider-picker
            class="add"
            label="Fahrer zu ${group.group_name} hinzufügen"
            placeholder="+ Fahrer hinzufügen…"
            .options=${riderOptions(this.data, candidates, (r) => {
              const other = elsewhere.get(r.id);
              return other ? `– schon in „${other}“` : "";
            })}
            @change=${
              // eslint-disable-next-line lit/no-template-arrow
              (e: CustomEvent<{ value: string }>) =>
                this.addMember(group, e.detail.value)
            }
          ></cup-rider-picker>`
        : nothing
    }`;
  }

  // --- Changes ---------------------------------------------------------

  async run(action: () => Promise<string | null | void>) {
    this.busy = true;
    try {
      const warning = await action();
      this.error = null;
      this.warning = warning || null;
      dataChanged(this);
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }

  /** Gives the place of `oldId` in a single or pair to another rider. */
  replace(act: ClubAct, oldId: string, newId: string) {
    if (newId && newId !== oldId) {
      this.run(() => replaceRider(act.id, oldId, newId));
    }
  }

  find(id: string): Rider | undefined {
    return this.riders.find((r) => r.id === id);
  }

  replacePendingRider(starter: ClubStarter, id: string) {
    const rider = this.find(id);
    if (!rider || rider.id === starter.id) {
      return;
    }
    const partner = starter.partner_name ?? "";
    this.run(async () => {
      await leavePair(starter, this.data.starters);
      await pairWithOtherClub(rider, partner, this.data.starters);
    });
  }

  renamePendingPartner(starter: ClubStarter, e: Event) {
    const name = (e.target as HTMLInputElement).value.trim();
    if (name === (starter.partner_name ?? "")) {
      return;
    }
    if (!name) {
      this.error = "Bitte gib den Namen des Partners an.";
      return;
    }
    this.run(() =>
      editStarter(starter, { partner_name: name, partner_id: null }),
    );
  }

  /** Pairs a waiting rider with a rider of the club or (admins) any club. */
  pairPending(starter: ClubStarter, id: string) {
    const partner = this.find(id);
    if (!partner) {
      return;
    }
    this.run(() =>
      linkPartners(
        { ...starter, club_id: this.data.club.id },
        partner,
        this.riders,
      ),
    );
  }

  addMember(group: ClubGroup, id: string) {
    const rider = this.find(id);
    if (rider) {
      this.setMember(group, rider.id, rider.club_id, false);
    }
  }

  /**
   * Adds a rider of `clubId` to the group (`false`: regular, `true`:
   * replacement) or removes them (`null`). The riders are set per club.
   */
  setMember(
    group: ClubGroup,
    starterId: string,
    clubId: string,
    replacement: boolean | null,
  ) {
    const members = ownGroupMembers(group, clubId).filter(
      (m) => m.starter_id !== starterId,
    );
    if (replacement !== null) {
      members.push({ starter_id: starterId, is_replacement: replacement });
    }
    if (
      members.length === 0 &&
      clubId === this.data.club.id &&
      !group.is_owner &&
      !confirm(
        `Das ist euer letzter Fahrer in „${group.group_name}“. Ohne eigene Fahrer verlasst ihr die Gruppe. Fortfahren?`,
      )
    ) {
      return;
    }
    this.run(() => setGroupMembers(clubId, group.id, members));
  }

  clearError() {
    this.error = null;
  }

  clearWarning() {
    this.warning = null;
  }
}
