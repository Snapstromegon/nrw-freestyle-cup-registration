import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { client, components } from "../../apiClient";
import { Task } from "@lit/task";
import "../elements/cup-context-club.js";
import "../elements/cup-club-manager.js";
import "../elements/cup-starter-table.js";

@customElement("cup-view-admin-starters")
export default class CupViewAdminStarters extends LitElement {
  static override styles = css`
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    .material-icon {
      font-family: "Material Symbols Outlined";
      font-weight: normal;
      font-style: normal;
      font-size: 24px;
      line-height: 1;
      letter-spacing: normal;
      text-transform: none;
      display: inline-block;
      white-space: nowrap;
      word-wrap: normal;
      direction: ltr;
      font-feature-settings: "liga";
      -webkit-font-smoothing: antialiased;
    }
  `;

  starters = new Task(this, {
    task: async () => {
      const data = await client.GET("/api/query/list_starters");
      if (data.error) {
        throw new Error((data.error as { message: string }).message);
      }
      const all = data.data;

      const singles = all.filter((s) => s.single_male || s.single_female);
      const pairStarters = all.filter((s) => s.pair);

      const pairs: {
        partners: [
          components["schemas"]["Starter"],
          components["schemas"]["Starter"]?
        ];
        maxAge: Date;
        sonderpokal: boolean;
      }[] = [];

      const pairStartersById = new Map();
      for (const starter of pairStarters) {
        pairStartersById.set(starter.id, starter);
      }

      for (const starter of pairStarters) {
        if (pairStartersById.has(starter.id)) {
          pairStartersById.delete(starter.id);
          let partner;
          let maxAge = new Date(starter.birthdate);
          let sonderpokal = starter.pair_sonderpokal;
          if (starter.partner_id) {
            partner = pairStartersById.get(starter.partner_id);
            if (partner) {
              maxAge = new Date(
                Math.min(
                  new Date(starter.birthdate).getTime(),
                  new Date(partner.birthdate).getTime()
                )
              );
              sonderpokal ||= partner.pair_sonderpokal;
              pairStartersById.delete(starter.partner_id);
            }
          }
          pairs.push({ partners: [starter, partner], maxAge, sonderpokal });
        }
      }

      console.log({ singles, pairs, all });
      return { singles, pairs, starters: all };
    },
    args: () => [],
  });

  override render() {
    return html` <a href="/admin">Anmeldeübersicht</a>
      ${this.starters.render({
        loading: () => html`Loading...`,
        error: (error) => html`Error: ${error}`,
        complete: ({ singles, pairs }) => {
          console.log({ singles, pairs });
          return html`
            <h2>Nachwuchscup</h2>
            <h3>Einzel Männlich</h3>
            <h4>U15</h4>
            <cup-starter-table
              .starters=${singles
                .filter(
                  (s) =>
                    !s.single_sonderpokal &&
                    s.single_male &&
                    isU15(new Date(s.birthdate))
                )
                .sort(
                  (a, b) =>
                    new Date(a.birthdate).getTime() -
                    new Date(b.birthdate).getTime()
                )}
            ></cup-starter-table>
            <h4>15+</h4>
            <cup-starter-table
              .starters=${singles
                .filter(
                  (s) =>
                    !s.single_sonderpokal &&
                    s.single_male &&
                    !isU15(new Date(s.birthdate))
                )
                .sort(
                  (a, b) =>
                    new Date(a.birthdate).getTime() -
                    new Date(b.birthdate).getTime()
                )}
            ></cup-starter-table>
            <h3>Einzel Weiblich</h3>
            <h4>U15</h4>
            <cup-starter-table
              .starters=${singles
                .filter(
                  (s) =>
                    !s.single_sonderpokal &&
                    s.single_female &&
                    isU15(new Date(s.birthdate))
                )
                .sort(
                  (a, b) =>
                    new Date(a.birthdate).getTime() -
                    new Date(b.birthdate).getTime()
                )}
            ></cup-starter-table>
            <h4>15+</h4>
            <cup-starter-table
              .starters=${singles
                .filter(
                  (s) =>
                    !s.single_sonderpokal &&
                    s.single_female &&
                    !isU15(new Date(s.birthdate))
                )
                .sort(
                  (a, b) =>
                    new Date(a.birthdate).getTime() -
                    new Date(b.birthdate).getTime()
                )}
            ></cup-starter-table>
            <h3>Paar</h3>
            <h4>U15</h4>
            <cup-starter-table
              .pairs=${pairs
                .filter((p) => !p.sonderpokal && isU15(p.maxAge))
                .sort((a, b) => a.maxAge.getTime() - b.maxAge.getTime())}
            ></cup-starter-table>
            <h4>15+</h4>
            <cup-starter-table
              .pairs=${pairs
                .filter((p) => !p.sonderpokal && !isU15(p.maxAge))
                .sort((a, b) => a.maxAge.getTime() - b.maxAge.getTime())}
            ></cup-starter-table>
            <h2>Sonderpokal</h2>
            <h3>Einzel</h3>
            <h4>U15</h4>
            <cup-starter-table
              .starters=${singles
                .filter(
                  (s) => s.single_sonderpokal && isU15(new Date(s.birthdate))
                )
                .sort(
                  (a, b) =>
                    new Date(a.birthdate).getTime() -
                    new Date(b.birthdate).getTime()
                )}
            ></cup-starter-table>
            <h4>15+</h4>
            <cup-starter-table
              .starters=${singles
                .filter(
                  (s) => s.single_sonderpokal && !isU15(new Date(s.birthdate))
                )
                .sort(
                  (a, b) =>
                    new Date(a.birthdate).getTime() -
                    new Date(b.birthdate).getTime()
                )}
            ></cup-starter-table>
            <h3>Paar</h3>
            <h4>U15</h4>
            <cup-starter-table
              .pairs=${pairs
                .filter((p) => p.sonderpokal && isU15(p.maxAge))
                .sort((a, b) => a.maxAge.getTime() - b.maxAge.getTime())}
            ></cup-starter-table>
            <h4>15+</h4>
            <cup-starter-table
              .pairs=${pairs
                .filter((p) => p.sonderpokal && !isU15(p.maxAge))
                .sort((a, b) => a.maxAge.getTime() - b.maxAge.getTime())}
            ></cup-starter-table>
          `;
        },
      })}`;
  }
}

const isU15 = (birthdate: Date) => {
  const cutoff = new Date("2010-03-16");
  return birthdate >= cutoff;
};
