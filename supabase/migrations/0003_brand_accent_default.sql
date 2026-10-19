-- RaveWall — brand accent default
--
-- The initial schema defaulted accent_color to the original brand colour
-- (#4f46e5). The application layer has validated and defaulted to the
-- RaveWall green (#15803d) since the rebrand; this aligns the column default
-- so direct inserts (seeds, future internal tooling) inherit the brand green
-- too. Existing rows are untouched: a column default only applies to new rows
-- that omit the column.

ALTER TABLE businesses ALTER COLUMN accent_color SET DEFAULT '#15803d';
