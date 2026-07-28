-- The demo data (0017) fictionalized buildings AND their names/project,
-- which is right for a general audit/demo but wrong for actually showing
-- this to Ulkan Development themselves -- they should see their own real
-- project ("Italiano Vero") and building names, not "Horizon Bay"/"Atlas".
-- Only renames buildings/units -- leads, clients, справки, payments, and
-- unit price/area/status all stay exactly as the fake-data seed left them;
-- this is a label swap, not a data revert. tenants.name was never touched
-- by 0017 and is already "Ulkan Development".

update public.buildings set project_name = 'Italiano Vero' where project_name = 'Horizon Bay';

do $$
declare
  v_tenant_id uuid;
  v_map text[][] := array[
    array['Atlas', 'Milano'],
    array['Vega', 'Roma'],
    array['Orion', 'Neapol'],
    array['Lyra', 'Venice'],
    array['Nova', 'Florencia']
  ];
  v_pair text[];
  v_building_id uuid;
begin
  select id into v_tenant_id from public.tenants limit 1;
  if v_tenant_id is null then return; end if;

  foreach v_pair slice 1 in array v_map loop
    select id into v_building_id from public.buildings where tenant_id = v_tenant_id and name = v_pair[1];
    if v_building_id is not null then
      -- unit_number is stored building-prefixed ("Atlas-101") -- update the
      -- prefix so it still matches the building's new name.
      update public.units set unit_number = v_pair[2] || '-' || split_part(unit_number, '-', 2)
        where building_id = v_building_id;
      update public.buildings set name = v_pair[2] where id = v_building_id;
    end if;
  end loop;
end $$;
