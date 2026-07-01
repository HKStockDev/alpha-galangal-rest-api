do $$
declare
  r record;
  new_entity_id uuid;
begin
  for r in
    select h.filer_id, h.filer
    from public.hedge_funds h
    where h.entity_id is null
  loop
    insert into public.entities (entity_type, key, name)
    values ('hedge_fund', r.filer_id::text, r.filer)
    on conflict (key) do update set name = excluded.name
    returning id into new_entity_id;
    if new_entity_id is null then
      select id into new_entity_id from public.entities where key = r.filer_id::text;
    end if;
    if new_entity_id is not null then
      update public.hedge_funds set entity_id = new_entity_id where filer_id = r.filer_id;
    end if;
  end loop;
end $$;

update public.formulas
set
  formula_level = case
    when key = 'hedge_fund_quality_score' then 'MASTER_MODEL'
    else 'DOMAIN_COMPOSITE'
  end,
  execution_type = 'deterministic',
  version = coalesce(version, 1),
  is_active = coalesce(is_active, true)
where formula_level is null or execution_type is null;

insert into public.formula_components (parent_formula_id, child_formula_id, weight)
select p.id, c.id, (p.definition->'weights'->>c.key)::numeric
from public.formulas p
cross join lateral jsonb_object_keys(p.definition->'weights') AS comp_key(key)
join public.formulas c on c.key = comp_key.key
where p.key = 'hedge_fund_quality_score'
  and p.definition->>'type' = 'composite'
  and not exists (
    select 1 from public.formula_components fc
    where fc.parent_formula_id = p.id and fc.child_formula_id = c.id
  );
