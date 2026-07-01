-- Profile avatar: public URL stored on profiles; files in storage bucket avatars.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text NULL;

COMMENT ON COLUMN public.profiles.avatar_url IS
  'Public URL for user avatar image (Supabase Storage avatars bucket).';

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS avatars_select_public ON storage.objects;
CREATE POLICY avatars_select_public
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

COMMIT;
