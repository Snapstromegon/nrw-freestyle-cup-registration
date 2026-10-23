// The club contact in the admin tables: name, email and whether it's
// verified; "–" for whoever may not see club contacts.
import { html, nothing } from "lit";
import type { schemas } from "../../apiClient";

export const renderContact = (
  contacts: schemas.ClubContacts | null | undefined,
) =>
  contacts
    ? html`${contacts.owner_name}
        <a
          class="email"
          href="mailto:${contacts.owner_email}"
          title=${contacts.owner_email}
          >${contacts.owner_email}</a
        >
        ${
          contacts.owner_email_verified
            ? nothing
            : html`<span class="chip warn">unverifiziert</span>`
        }`
    : "–";
