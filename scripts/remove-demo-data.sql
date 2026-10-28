-- Removes the seeded demo landowner and its demo listings that the first migration creates.
-- Run ONLY on your new project, before launch:  psql ... -f scripts/remove-demo-data.sql
-- (or paste it into the Supabase SQL editor).
DELETE FROM public.slots WHERE owner_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001';
