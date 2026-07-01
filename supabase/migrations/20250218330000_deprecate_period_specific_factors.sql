BEGIN;

UPDATE public.factors
SET name = CASE
  WHEN name LIKE '[DEPRECATED]%' THEN name
  ELSE '[DEPRECATED] ' || name
END
WHERE key ~ '_\d+_yr' OR key ~ '_\d+_year';

COMMIT;
