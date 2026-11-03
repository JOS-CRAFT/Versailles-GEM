-- Autorisations par utilisateur pour les points et les profils de matériel.
-- À exécuter dans Supabase > SQL Editor après les migrations Matériel/Baies.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS can_create_locations boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_edit_locations boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_create_speaker_types boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_create_machine_types boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS editable_type_ids text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid();

ALTER TABLE public.speaker_types
    ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid();

-- Fonctions SECURITY DEFINER évitent les récursions RLS lors de la lecture du profil courant.
CREATE OR REPLACE FUNCTION public.app_current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE((
        SELECT p.is_admin IS TRUE
        FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
    ), false);
$$;

CREATE OR REPLACE FUNCTION public.app_user_can_create_locations()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.app_current_user_is_admin() OR COALESCE((
        SELECT p.can_create_locations
        FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
    ), false);
$$;

CREATE OR REPLACE FUNCTION public.app_user_can_edit_locations()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.app_current_user_is_admin() OR COALESCE((
        SELECT p.can_edit_locations
        FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
    ), false);
$$;

CREATE OR REPLACE FUNCTION public.app_user_can_create_type(p_kind text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.app_current_user_is_admin() OR COALESCE((
        SELECT CASE p_kind
            WHEN 'machine' THEN p.can_create_machine_types
            WHEN 'speaker' THEN p.can_create_speaker_types
            ELSE false
        END
        FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
    ), false);
$$;

CREATE OR REPLACE FUNCTION public.app_user_can_edit_type(p_type_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.app_current_user_is_admin() OR COALESCE((
        SELECT p.editable_type_ids @> ARRAY[p_type_id]::text[]
        FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
    ), false);
$$;

GRANT EXECUTE ON FUNCTION public.app_current_user_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_user_can_create_locations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_user_can_edit_locations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_user_can_create_type(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_user_can_edit_type(text) TO authenticated;

-- Un utilisateur ne peut pas s'accorder lui-même des droits.
CREATE OR REPLACE FUNCTION public.app_guard_profile_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (SELECT auth.uid()) IS NOT NULL
       AND OLD.id = (SELECT auth.uid())
       AND NOT public.app_current_user_is_admin()
       AND (
           NEW.is_admin IS DISTINCT FROM OLD.is_admin
           OR NEW.can_create_locations IS DISTINCT FROM OLD.can_create_locations
           OR NEW.can_edit_locations IS DISTINCT FROM OLD.can_edit_locations
           OR NEW.can_create_speaker_types IS DISTINCT FROM OLD.can_create_speaker_types
           OR NEW.can_create_machine_types IS DISTINCT FROM OLD.can_create_machine_types
           OR NEW.editable_type_ids IS DISTINCT FROM OLD.editable_type_ids
       ) THEN
        RAISE EXCEPTION 'Seul un administrateur peut modifier les autorisations';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_guard_profile_permissions ON public.profiles;
CREATE TRIGGER app_guard_profile_permissions
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.app_guard_profile_permissions();

-- Les utilisateurs ne peuvent pas transférer à un autre compte la propriété d'un objet qu'ils créent.
CREATE OR REPLACE FUNCTION public.app_guard_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (SELECT auth.uid()) IS NOT NULL
       AND NOT public.app_current_user_is_admin()
       AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'Seul un administrateur peut modifier le créateur';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_guard_location_created_by ON public.locations;
CREATE TRIGGER app_guard_location_created_by
    BEFORE UPDATE ON public.locations
    FOR EACH ROW EXECUTE FUNCTION public.app_guard_created_by();

-- Les comptes sans droit d'édition gardent la récupération et les commentaires, comme dans l'application actuelle.
CREATE OR REPLACE FUNCTION public.app_guard_location_update_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    allowed_shared_fields text[] := ARRAY[
        'recovered', 'recovered_by', 'recovered_by_name', 'recovered_at',
        'comment', 'comment_by', 'comment_by_name', 'comment_at', 'updated_at'
    ];
BEGIN
    IF (SELECT auth.uid()) IS NOT NULL
       AND NOT public.app_current_user_is_admin()
       AND NOT public.app_user_can_edit_locations()
       AND NOT (public.app_user_can_create_locations() AND OLD.created_by = (SELECT auth.uid()))
       AND (to_jsonb(NEW) - allowed_shared_fields) IS DISTINCT FROM (to_jsonb(OLD) - allowed_shared_fields) THEN
        RAISE EXCEPTION 'Vous n’êtes pas autorisé à modifier ce point';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_guard_location_update_fields ON public.locations;
CREATE TRIGGER app_guard_location_update_fields
    BEFORE UPDATE ON public.locations
    FOR EACH ROW EXECUTE FUNCTION public.app_guard_location_update_fields();

DROP TRIGGER IF EXISTS app_guard_type_created_by ON public.speaker_types;
CREATE TRIGGER app_guard_type_created_by
    BEFORE UPDATE ON public.speaker_types
    FOR EACH ROW EXECUTE FUNCTION public.app_guard_created_by();

CREATE OR REPLACE FUNCTION public.app_guard_type_kind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (SELECT auth.uid()) IS NOT NULL
       AND NOT public.app_current_user_is_admin()
       AND NEW.equipment_kind IS DISTINCT FROM OLD.equipment_kind THEN
        RAISE EXCEPTION 'Seul un administrateur peut changer la catégorie d’un profil matériel';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_guard_type_kind ON public.speaker_types;
CREATE TRIGGER app_guard_type_kind
    BEFORE UPDATE ON public.speaker_types
    FOR EACH ROW EXECUTE FUNCTION public.app_guard_type_kind();

-- Admin : liste de tous les comptes et attribution des droits. Les utilisateurs gardent la lecture/modification de leur profil.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

DROP POLICY IF EXISTS app_profiles_admin_read ON public.profiles;
CREATE POLICY app_profiles_admin_read
    ON public.profiles FOR SELECT TO authenticated
    USING (public.app_current_user_is_admin());

DO $$
DECLARE policy_row record;
BEGIN
    FOR policy_row IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd IN ('UPDATE', 'ALL')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.profiles', policy_row.policyname);
    END LOOP;
END;
$$;

CREATE POLICY app_profiles_update_own
    ON public.profiles FOR UPDATE TO authenticated
    USING (id = (SELECT auth.uid()))
    WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY app_profiles_admin_update
    ON public.profiles FOR UPDATE TO authenticated
    USING (public.app_current_user_is_admin())
    WITH CHECK (public.app_current_user_is_admin());

-- Points : chaque utilisateur connecté peut consulter la carte. Les droits contrôlent les écritures.
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;

DO $$
DECLARE policy_row record;
BEGIN
    FOR policy_row IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'locations' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.locations', policy_row.policyname);
    END LOOP;
END;
$$;

DROP POLICY IF EXISTS app_locations_read_authenticated ON public.locations;
CREATE POLICY app_locations_read_authenticated
    ON public.locations FOR SELECT TO authenticated USING (true);

CREATE POLICY app_locations_create_authorized
    ON public.locations FOR INSERT TO authenticated
    WITH CHECK (
        public.app_current_user_is_admin()
        OR (public.app_user_can_create_locations() AND created_by = (SELECT auth.uid()))
    );

CREATE POLICY app_locations_update_authenticated
    ON public.locations FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY app_locations_delete_admin
    ON public.locations FOR DELETE TO authenticated
    USING (public.app_current_user_is_admin());

-- Profils matériel : les utilisateurs peuvent créer selon leur droit, modifier seulement les profils attribués.
ALTER TABLE public.speaker_types ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.speaker_types TO authenticated;

DO $$
DECLARE policy_row record;
BEGIN
    FOR policy_row IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'speaker_types' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    LOOP
        EXECUTE format('DROP POLICY %I ON public.speaker_types', policy_row.policyname);
    END LOOP;
END;
$$;

DROP POLICY IF EXISTS app_speaker_types_read_authenticated ON public.speaker_types;
CREATE POLICY app_speaker_types_read_authenticated
    ON public.speaker_types FOR SELECT TO authenticated USING (true);

CREATE POLICY app_speaker_types_create_authorized
    ON public.speaker_types FOR INSERT TO authenticated
    WITH CHECK (
        public.app_current_user_is_admin()
        OR (public.app_user_can_create_type(equipment_kind) AND created_by = (SELECT auth.uid()))
    );

CREATE POLICY app_speaker_types_update_authorized
    ON public.speaker_types FOR UPDATE TO authenticated
    USING (
        public.app_current_user_is_admin()
        OR public.app_user_can_edit_type(id)
        OR (created_by = (SELECT auth.uid()) AND public.app_user_can_create_type(equipment_kind))
    )
    WITH CHECK (
        public.app_current_user_is_admin()
        OR public.app_user_can_edit_type(id)
        OR (created_by = (SELECT auth.uid()) AND public.app_user_can_create_type(equipment_kind))
    );

CREATE POLICY app_speaker_types_delete_admin
    ON public.speaker_types FOR DELETE TO authenticated
    USING (public.app_current_user_is_admin());

-- Publier profiles en temps réel pour appliquer immédiatement les nouveaux droits à l'utilisateur connecté.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
    END IF;
END;
$$;
