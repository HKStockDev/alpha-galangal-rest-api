do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'formula_level_check') then
    alter table public.formulas
      add constraint formula_level_check
      check (formula_level in ('ATOMIC','DOMAIN_COMPOSITE','MASTER_MODEL'));
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'execution_type_check') then
    alter table public.formulas
      add constraint execution_type_check
      check (execution_type in ('deterministic','hybrid','llm'));
  end if;
end
$$;
