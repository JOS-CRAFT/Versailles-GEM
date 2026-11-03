-- Délimitations et noms des bosquets affichés sur la carte.
-- À exécuter dans Supabase > SQL Editor.

CREATE TABLE IF NOT EXISTS public.bosquets (
    id text PRIMARY KEY,
    name text NOT NULL DEFAULT '',
    coordinates jsonb NOT NULL,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bosquets_name_length_check CHECK (char_length(name) <= 80),
    CONSTRAINT bosquets_coordinates_minimum_check CHECK (
        CASE
            WHEN jsonb_typeof(coordinates) = 'array' THEN jsonb_array_length(coordinates) >= 3
            ELSE false
        END
    )
);

ALTER TABLE public.bosquets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bosquets TO authenticated;

DROP POLICY IF EXISTS bosquets_read_authenticated ON public.bosquets;
CREATE POLICY bosquets_read_authenticated
    ON public.bosquets FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS bosquets_admin_manage ON public.bosquets;
CREATE POLICY bosquets_admin_manage
    ON public.bosquets FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = (SELECT auth.uid()) AND p.is_admin IS TRUE
        )
    );

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'bosquets'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.bosquets;
    END IF;
END;
$$;
