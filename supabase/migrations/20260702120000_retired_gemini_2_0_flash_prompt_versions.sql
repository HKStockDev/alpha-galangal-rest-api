BEGIN;

-- gemini-2.0-flash was retired by Google; services read model_name from prompt_versions.
UPDATE public.prompt_versions
SET model_name = 'gemini-2.5-flash'
WHERE model_name IN ('gemini-2.0-flash', 'models/gemini-2.0-flash');

COMMIT;
