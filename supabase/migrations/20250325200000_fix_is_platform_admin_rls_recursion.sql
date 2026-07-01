-- is_platform_admin() must bypass RLS on the inner profiles read; otherwise
-- profiles_select_platform_admin USING (is_platform_admin()) causes infinite
-- recursion ("stack depth limit exceeded") on any profiles access.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.is_platform_admin FROM public.profiles p WHERE p.id = auth.uid()),
    false
  );
$$;

COMMENT ON FUNCTION public.is_platform_admin() IS
  'SECURITY DEFINER so the profiles lookup bypasses RLS; avoids recursion with profiles_select_platform_admin.';

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

COMMIT;
