-- ============================================================================
-- Phase 1 / 0013 — corrective migration (defect found by the Phase 1 pgTAP suite)
-- ============================================================================
-- The articles migration gave hero_kind a default of 'svg' while also constraining
--   image_hero_has_alt: hero_kind = 'none' OR hero_alt IS NOT NULL
-- Together those made the default self-contradictory: any insert that did not
-- explicitly supply hero_alt violated the check, so a draft article could not be
-- created at all. The constraint is right; the default was wrong.
--
-- Corrected as:
--   * default hero_kind = 'none'  — an article genuinely has no hero until one is
--     assigned, and the generation pipeline sets it explicitly,
--   * image_hero_has_alt stays    — if there IS an image it must have alt text,
--   * NEW published_has_hero      — a PUBLISHED article may not have hero_kind
--     'none'. This encodes the editorial rule that every published article carries
--     visual content, with the generated category SVG as the guaranteed fallback,
--     while still letting drafts exist before artwork is chosen.

alter table public.articles alter column hero_kind set default 'none';

alter table public.articles
  add constraint published_has_hero
  check (status <> 'published' or hero_kind <> 'none');

comment on constraint published_has_hero on public.articles is
  'A published article must have a hero (thumbnail or generated SVG); drafts may have none. Encodes "no article is ever a wall of plain text".';
comment on constraint image_hero_has_alt on public.articles is
  'Alt text is mandatory whenever a hero image exists (accessibility).';
