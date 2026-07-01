-- Seed entity_scores_history from entity_scores_current (one history row per entity/formula)
insert into public.entity_scores_history (entity_id, formula_id, score, computed_at)
select c.entity_id, c.formula_id, c.score, coalesce(c.updated_at, now())
from public.entity_scores_current c
where not exists (
  select 1 from public.entity_scores_history h
  where h.entity_id = c.entity_id and h.formula_id = c.formula_id
);

-- Fill source for entity_factor_values (hedge fund CSV exported/imported from WhaleWisdom)
update public.entity_factor_values
set source = 'whalewisdom_hedge_fund_csv'
where source is null;
