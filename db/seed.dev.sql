-- Local dev seed. Safe to re-run (ON CONFLICT DO NOTHING).
-- Demo student/content fixtures land in later phases (Phase 1+ content, Phase 6
-- onboarding seed); Phase 0 only needs a dogfood org to develop against before
-- Supabase Auth signup creates real orgs.

insert into orgs (id, name, plan)
values ('org_dev_konrad', 'Konrad (dev)', 'studio')
on conflict (id) do nothing;
