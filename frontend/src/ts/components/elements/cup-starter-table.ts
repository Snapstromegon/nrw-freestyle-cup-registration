import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { components } from "../../bindings";

@customElement("cup-starter-table")
export default class CupStarterTable extends LitElement {
  @property({ type: Array }) starters: components["schemas"]["Starter"][] = [];
  @property({ type: Array }) pairs: {
    partners: [
      components["schemas"]["Starter"],
      components["schemas"]["Starter"]?,
    ];
    maxAge: Date;
    sonderpokal: boolean;
  }[] = [];

  override render() {
    return html` <table>
      <thead>
        <tr>
          <th>NR</th>
          ${this.pairs.length ? html`<th>Max Alter</th>` : nothing}
          <th>ID</th>
          <th>Club Name</th>
          <th>Vorname</th>
          <th>Nachname</th>
          <th>Geburtstag</th>
          <th>Alter</th>
          ${
            this.pairs.length
              ? html`
                <th>ID</th>
                <th>Club Name</th>
                <th>Vorname</th>
                <th>Nachname</th>
                <th>Geburtstag</th>
                <th>Alter</th>
              `
              : nothing
          }
        </tr>
      </thead>
      <tbody>
        ${
          this.pairs.length
            ? this.pairs.map((pair, i) => {
                const [starter, partner] = pair.partners;
                return html`
                <tr>
                  <td>${i + 1}</td>
                  <td>${pair.maxAge.toLocaleDateString()}</td>
                  <td>${starter.id}</td>
                  <td>${starter.club_name}</td>
                  <td>${starter.firstname}</td>
                  <td>${starter.lastname}</td>
                  <td>${new Date(starter.birthdate).toLocaleDateString()}</td>
                  <td>${starter.age_on_competition.toFixed(2)}</td>
                  <td>${partner ? partner.id : nothing}</td>
                  <td>${partner ? partner.club_name : nothing}</td>
                  <td>${partner ? partner.firstname : starter.partner_name}</td>
                  <td>${partner ? partner.lastname : nothing}</td>
                  <td>
                    ${
                      partner
                        ? new Date(partner.birthdate).toLocaleDateString()
                        : nothing
                    }
                  </td>
                  <td>
                    ${partner ? partner.age_on_competition.toFixed(2) : nothing}
                  </td>
                </tr>
              `;
              })
            : this.starters.map(
                (starter, i) => html`
                <tr>
                  <td>${i + 1}</td>
                  <td>${starter.id}</td>
                  <td>${starter.club_name}</td>
                  <td>${starter.firstname}</td>
                  <td>${starter.lastname}</td>
                  <td>${new Date(starter.birthdate).toLocaleDateString()}</td>
                  <td>${starter.age_on_competition}</td>
                </tr>
              `,
              )
        }
      </tbody>
    </table>`;
  }
}
