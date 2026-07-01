BEGIN;

-- gemini-2.0-flash was retired; cycle score sync reads model_name from active prompt_versions.
UPDATE public.prompt_versions pv
SET model_name = 'gemini-2.5-flash'
FROM public.prompts p
WHERE pv.prompt_id = p.id
  AND p.key IN (
    'sector_cycle_score',
    'industry_cycle_score',
    'sub_industry_cycle_score'
  )
  AND pv.model_name IN ('gemini-2.0-flash', 'models/gemini-2.0-flash');

COMMIT;
