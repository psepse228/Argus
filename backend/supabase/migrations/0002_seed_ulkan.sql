-- Seed Ulkan Development's real 5-building structure (Italiano Vero project).
-- Milano is nearly complete (real floor plans/pricing available); Roma just
-- started construction (no real floor plans yet — Milano's are used as
-- beta-test stand-ins, see PLANNING.md); the other 3 aren't started.

insert into public.tenants (name) values ('Ulkan Development');

insert into public.buildings (tenant_id, name, project_name, status)
select id, 'Milano', 'Italiano Vero', 'nearly_complete' from public.tenants where name = 'Ulkan Development'
union all
select id, 'Roma', 'Italiano Vero', 'construction' from public.tenants where name = 'Ulkan Development'
union all
select id, 'Neapol', 'Italiano Vero', 'construction' from public.tenants where name = 'Ulkan Development'
union all
select id, 'Venice', 'Italiano Vero', 'construction' from public.tenants where name = 'Ulkan Development'
union all
select id, 'Florencia', 'Italiano Vero', 'construction' from public.tenants where name = 'Ulkan Development';
