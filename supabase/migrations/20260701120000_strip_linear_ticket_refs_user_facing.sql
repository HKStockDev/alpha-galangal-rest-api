-- Strip Linear-style ticket references (CON-*, SKE-*) from user-facing text columns.

BEGIN;

CREATE OR REPLACE FUNCTION public.strip_linear_ticket_refs(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              COALESCE(input, ''),
              '\s*\((?:CON|SKE)-[0-9]+[^)]*\)', '', 'gi'
            ),
            '^(?:CON|SKE)-[0-9]+:\s*', '', 'gi'
          ),
          '\s+\.', '.', 'g'
        ),
        '\s{2,}', ' ', 'g'
      )
    ),
    ''
  );
$$;

COMMENT ON FUNCTION public.strip_linear_ticket_refs(text) IS
  'Removes Linear ticket prefixes (CON-123:, SKE-45:) and parenthetical refs from user-facing copy.';

-- formulas
UPDATE public.formulas
SET description = public.strip_linear_ticket_refs(description)
WHERE description IS NOT NULL
  AND description ~ '(CON|SKE)-[0-9]+';

UPDATE public.formulas
SET seo_description = public.strip_linear_ticket_refs(seo_description)
WHERE seo_description IS NOT NULL
  AND seo_description ~ '(CON|SKE)-[0-9]+';

-- factors
UPDATE public.factors
SET description = public.strip_linear_ticket_refs(description)
WHERE description IS NOT NULL
  AND description ~ '(CON|SKE)-[0-9]+';

-- formula marketing releases
UPDATE public.formula_marketing_releases
SET
  subtitle = public.strip_linear_ticket_refs(subtitle),
  body = public.strip_linear_ticket_refs(body),
  seo_title = public.strip_linear_ticket_refs(seo_title),
  seo_description = public.strip_linear_ticket_refs(seo_description)
WHERE subtitle ~ '(CON|SKE)-[0-9]+'
   OR body ~ '(CON|SKE)-[0-9]+'
   OR seo_title ~ '(CON|SKE)-[0-9]+'
   OR seo_description ~ '(CON|SKE)-[0-9]+';

-- exposures / tags (public marketing hubs)
UPDATE public.exposures
SET
  description = public.strip_linear_ticket_refs(description),
  seo_description = public.strip_linear_ticket_refs(seo_description)
WHERE description ~ '(CON|SKE)-[0-9]+'
   OR seo_description ~ '(CON|SKE)-[0-9]+';

UPDATE public.tags
SET
  description = public.strip_linear_ticket_refs(description),
  seo_description = public.strip_linear_ticket_refs(seo_description)
WHERE description ~ '(CON|SKE)-[0-9]+'
   OR seo_description ~ '(CON|SKE)-[0-9]+';

-- prompt catalog descriptions (may surface in admin UI)
UPDATE public.prompts
SET description = public.strip_linear_ticket_refs(description)
WHERE description IS NOT NULL
  AND description ~ '(CON|SKE)-[0-9]+';

COMMIT;
