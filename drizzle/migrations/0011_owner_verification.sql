-- 0011: landowner verification (scenario S17)
-- Owners upload an ID proof and an ownership proof. Admins review them. A listing can only be set to
-- 'approved' once the owner's LATEST document of each kind is approved. Additive and safe to run twice.
-- Needs: public.is_privileged() (0000), public.has_role() , public.slots.approval_status.

-- ===== table =====
CREATE TABLE IF NOT EXISTS public.owner_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('id_proof', 'ownership_proof')),
  storage_path text NOT NULL CHECK (char_length(storage_path) BETWEEN 3 AND 300),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note         text CHECK (note IS NULL OR char_length(note) <= 500),
  reviewed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  -- clock_timestamp() so two uploads in one transaction still order correctly
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.owner_documents IS
  'Owner ID/ownership proofs. History is kept: each upload is a new row; the latest row per kind counts.';

CREATE INDEX IF NOT EXISTS owner_documents_owner_kind_created_idx
  ON public.owner_documents (owner_id, kind, created_at DESC);

-- ===== privileges =====
-- No DELETE for anyone but service_role: history is never deleted through the app.
REVOKE ALL ON public.owner_documents FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.owner_documents TO authenticated;
GRANT UPDATE (status, note, reviewed_by, reviewed_at) ON public.owner_documents TO authenticated;
GRANT ALL ON public.owner_documents TO service_role;

ALTER TABLE public.owner_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_documents read own or admin" ON public.owner_documents;
CREATE POLICY "owner_documents read own or admin" ON public.owner_documents
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "owner_documents insert own" ON public.owner_documents;
CREATE POLICY "owner_documents insert own" ON public.owner_documents
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- Owners can SEE their rows for UPDATE so the guard trigger below rejects them loudly
-- (without this they would silently update zero rows).
DROP POLICY IF EXISTS "owner_documents update own or admin" ON public.owner_documents;
CREATE POLICY "owner_documents update own or admin" ON public.owner_documents
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ===== guards on owner_documents =====
CREATE OR REPLACE FUNCTION public.guard_owner_documents_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A file must live under the owner's own folder in the owner-docs bucket.
    IF NEW.storage_path NOT LIKE NEW.owner_id::text || '/%' THEN
      RAISE EXCEPTION 'Document path must start with the owner id';
    END IF;
    IF NOT public.is_privileged() THEN
      -- Owners can never self-approve or set review fields.
      NEW.status := 'pending'; NEW.note := NULL; NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only admins/service may review.
  IF NOT public.is_privileged() THEN
    RAISE EXCEPTION 'Only Usop admins can review documents';
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Only the review status and note of a document can change';
  END IF;
  IF auth.uid() IS NOT NULL THEN NEW.reviewed_by := auth.uid(); END IF;  -- cannot be forged by an admin
  IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.reviewed_at := COALESCE(NEW.reviewed_at, now()); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_owner_documents_write_trg ON public.owner_documents;
CREATE TRIGGER guard_owner_documents_write_trg
  BEFORE INSERT OR UPDATE ON public.owner_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_documents_write();

-- ===== "is this owner verified?" =====
-- Internal helper: latest document of each kind must be approved.
CREATE OR REPLACE FUNCTION public.owner_documents_approved(_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT status FROM public.owner_documents
                    WHERE owner_id = _owner AND kind = 'id_proof'
                    ORDER BY created_at DESC, id DESC LIMIT 1) = 'approved', false)
     AND COALESCE((SELECT status FROM public.owner_documents
                    WHERE owner_id = _owner AND kind = 'ownership_proof'
                    ORDER BY created_at DESC, id DESC LIMIT 1) = 'approved', false)
$$;
REVOKE EXECUTE ON FUNCTION public.owner_documents_approved(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_documents_approved(uuid) TO service_role;

-- For the owner screen: the caller's own latest status per kind. Reads nobody else's data.
CREATE OR REPLACE FUNCTION public.my_verification_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id_proof', (SELECT status FROM public.owner_documents
                  WHERE owner_id = auth.uid() AND kind = 'id_proof'
                  ORDER BY created_at DESC, id DESC LIMIT 1),
    'ownership_proof', (SELECT status FROM public.owner_documents
                         WHERE owner_id = auth.uid() AND kind = 'ownership_proof'
                         ORDER BY created_at DESC, id DESC LIMIT 1),
    'verified', public.owner_documents_approved(auth.uid()))
$$;
REVOKE EXECUTE ON FUNCTION public.my_verification_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_verification_status() TO authenticated, service_role;

-- ===== listing gate =====
-- A listing may become 'approved' (on insert or update) only if its owner's documents are approved.
-- Applies to EVERY caller including admins and service_role (no override). Already-approved
-- listings are not re-checked, and edits that don't touch approval_status never fire this.
CREATE OR REPLACE FUNCTION public.guard_slot_requires_verified_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.approval_status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.approval_status IS DISTINCT FROM 'approved') THEN
    IF NOT public.owner_documents_approved(NEW.owner_id) THEN
      RAISE EXCEPTION 'Owner needs an approved ID proof and ownership proof before this listing can be approved';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Name sorts after guard_slot_write so non-privileged inserts are forced to 'pending' first.
DROP TRIGGER IF EXISTS zz_slot_requires_verified_owner_trg ON public.slots;
CREATE TRIGGER zz_slot_requires_verified_owner_trg
  BEFORE INSERT OR UPDATE OF approval_status ON public.slots
  FOR EACH ROW EXECUTE FUNCTION public.guard_slot_requires_verified_owner();

-- ===== private storage bucket =====
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('owner-docs', 'owner-docs', false, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Upload only into your own folder (<owner id>/...); read your own files; admins read all.
-- No UPDATE or DELETE policy: files are never changed or removed through the app.
DROP POLICY IF EXISTS "owner-docs upload own folder" ON storage.objects;
CREATE POLICY "owner-docs upload own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'owner-docs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "owner-docs read own or admin" ON storage.objects;
CREATE POLICY "owner-docs read own or admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'owner-docs'
         AND ((storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(), 'admin')));
