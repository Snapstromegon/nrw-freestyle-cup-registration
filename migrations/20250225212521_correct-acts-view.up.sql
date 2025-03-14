-- Add up migration script here
DROP VIEW IF EXISTS view_act;

CREATE VIEW
  view_act AS
SELECT
  a.*,
  (
    SELECT
      MAX(s.age_on_competition)
    FROM
      starter s
      JOIN act_participants p ON p.starter_id = s.id
    WHERE
      p.act_id = a.id
  ) AS max_age,
  (
    CASE
      WHEN a.is_pair THEN (
        SELECT
          MAX(s.pair_sonderpokal)
        FROM
          starter s
          JOIN act_participants p ON p.starter_id = s.id
        WHERE
          p.act_id = a.id
      )
      ELSE (
        SELECT
          MAX(s.single_sonderpokal)
        FROM
          starter s
          JOIN act_participants p ON p.starter_id = s.id
        WHERE
          p.act_id = a.id
      )
    END
  ) AS is_sonderpokal,
  (
    SELECT
      json_group_array (
        json_object (
          'firstname',
          starter.firstname,
          'lastname',
          starter.lastname,
          'id',
          hex (starter.id),
          'club_name',
          clubs.name
        )
      )
    FROM
      starter
      JOIN act_participants p ON p.starter_id = starter.id
      JOIN clubs ON clubs.id = starter.club_id
    WHERE
      p.act_id = a.id
  ) AS participants,
  (
    SELECT
      categories.name
    FROM
      categories
    WHERE
      categories.is_pair = a.is_pair
      AND categories.is_sonderpokal = (
        CASE
          WHEN a.is_pair THEN (
            SELECT
              MAX(s.pair_sonderpokal)
            FROM
              starter s
              JOIN act_participants p ON p.starter_id = s.id
            WHERE
              p.act_id = a.id
          )
          ELSE (
            SELECT
              MAX(s.single_sonderpokal)
            FROM
              starter s
              JOIN act_participants p ON p.starter_id = s.id
            WHERE
              p.act_id = a.id
          )
        END
      )
      AND (
        CASE
          WHEN categories.is_single_male THEN (
            SELECT
              MIN(s.single_male)
            FROM
              starter s
              JOIN act_participants p ON p.starter_id = s.id
            WHERE
              p.act_id = a.id
            LIMIT 1
          )
          ELSE TRUE
        END
      )
      AND categories.from_birthday <= (
        SELECT
          MIN(s.birthdate)
        FROM
          starter s
          JOIN act_participants p ON p.starter_id = s.id
        WHERE
          p.act_id = a.id
      )
      AND categories.to_birthday > (
        SELECT
          MIN(s.birthdate)
        FROM
          starter s
          JOIN act_participants p ON p.starter_id = s.id
        WHERE
          p.act_id = a.id
      )
    LIMIT
      1
  ) AS category
FROM
  acts a;
