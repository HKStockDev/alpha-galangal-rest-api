BEGIN;

-- Remove Linear-style ticket prefixes from social prompt audit notes (e.g. CON-176, CON-177).
UPDATE public.social_prompt_templates
SET change_note = trim(regexp_replace(change_note, '^CON-[0-9]+\s+', ''))
WHERE change_note IS NOT NULL
  AND change_note ~ '^CON-[0-9]+\s+';

COMMIT;
