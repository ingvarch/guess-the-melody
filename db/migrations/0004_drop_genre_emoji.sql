-- Emoji on genres was decorative-only (shown solely in admin selects, never on
-- the host/display game UI). Dropped to simplify the model.
ALTER TABLE genres DROP COLUMN emoji;
