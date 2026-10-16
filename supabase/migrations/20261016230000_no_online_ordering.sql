-- The POS sells in the restaurant only: no online ordering. The online
-- ordering functions are closed to everyone (nobody signed out can reach
-- anything again), and the setting is off. Kiosk orders (in the
-- restaurant, paid at the counter) are unchanged.

revoke execute on function
  public.list_online_branches(),
  public.get_public_menu(uuid),
  public.place_online_order(uuid, jsonb),
  public.get_online_order(uuid),
  public.set_online_ordering(uuid, boolean)
from public, anon, authenticated;

revoke execute on function
  public.start_online_payment(uuid, text, text),
  public.confirm_online_payment(text, integer, text)
from public, anon, authenticated, service_role;

update public.settings set value = 'false' where key = 'online.enabled';
