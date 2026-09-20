REVOKE ALL ON FUNCTION public.claim_owner_role() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, authenticated, PUBLIC;
DROP FUNCTION public.claim_owner_role();
DROP FUNCTION public.has_role(uuid, public.app_role);
REVOKE INSERT ON public.user_roles FROM authenticated;
CREATE UNIQUE INDEX user_roles_single_role_idx ON public.user_roles (role);