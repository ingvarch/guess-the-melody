-- Russian-language buckets for the party catalogue, alongside the generic
-- rock/pop/hip-hop seeds. Low sort_order keeps them grouped at the top for a
-- Russian-speaking audience. INSERT OR IGNORE so re-running is harmless.
INSERT OR IGNORE INTO genres (slug, name, sort_order) VALUES
  ('russian-rock', 'Русский рок', 5),
  ('russian-pop',  'Русский поп', 6);
