-- Backfill formulas.active_prompt_version_id for alpha_galangal_committee_llm when missing
update public.formulas f
set active_prompt_version_id = (
  select pv.id from public.formula_prompt_versions pv
  where pv.formula_id = f.id and pv.status = 'active'
  order by pv.version desc
  limit 1
)
where f.key = 'alpha_galangal_committee_llm'
  and f.active_prompt_version_id is null;
