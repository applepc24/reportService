CREATE TABLE IF NOT EXISTS dong (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT
);

CREATE TABLE IF NOT EXISTS poi_pub (
  id           SERIAL PRIMARY KEY,
  dong_id      INTEGER NOT NULL REFERENCES dong(id),
  name         TEXT NOT NULL,
  category     TEXT,
  rating       NUMERIC(2,1),
  review_count INTEGER DEFAULT 0,
  price_tier   TEXT
);


CREATE TABLE IF NOT EXISTS review (
  id      SERIAL PRIMARY KEY,
  poi_id  INTEGER NOT NULL REFERENCES poi_pub(id),
  rating  INTEGER,
  date    DATE,
  text    TEXT
);