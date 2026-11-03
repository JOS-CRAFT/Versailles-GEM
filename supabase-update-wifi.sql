-- GEM: bornes Wi-Fi, identifiants publics et mots de passe réservés aux admins.
-- À exécuter dans Supabase > SQL Editor après supabase-update-baies.sql.

-- Ajouter l'icône de catégorie Wi-Fi à la contrainte existante.
ALTER TABLE public.categories
    DROP CONSTRAINT IF EXISTS categories_shape_check;

ALTER TABLE public.categories
    ADD CONSTRAINT categories_shape_check
    CHECK (shape IN ('circle', 'square', 'diamond', 'triangle', 'hexagon', 'octagon', 'rack', 'wifi'));

-- Fiche de chaque borne : SSID et identifiant visibles par les utilisateurs connectés.
CREATE TABLE IF NOT EXISTS public.wifi_devices (
    id text PRIMARY KEY,
    ssid text NOT NULL,
    device_code text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Les mots de passe sont séparés afin de les réserver aux administrateurs.
CREATE TABLE IF NOT EXISTS public.wifi_device_secrets (
    wifi_device_id text PRIMARY KEY REFERENCES public.wifi_devices(id) ON DELETE CASCADE,
    password text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS wifi_device_id text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'locations_wifi_device_id_fkey'
          AND conrelid = 'public.locations'::regclass
    ) THEN
        ALTER TABLE public.locations
            ADD CONSTRAINT locations_wifi_device_id_fkey
            FOREIGN KEY (wifi_device_id)
            REFERENCES public.wifi_devices(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS locations_wifi_device_id_idx
    ON public.locations (wifi_device_id);

-- Les comptes connectés peuvent lire SSID et identifiant. Les modifications restent admin.
ALTER TABLE public.wifi_devices ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wifi_devices TO authenticated;

DROP POLICY IF EXISTS wifi_devices_read_authenticated ON public.wifi_devices;
CREATE POLICY wifi_devices_read_authenticated
    ON public.wifi_devices
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS wifi_devices_admin_manage ON public.wifi_devices;
CREATE POLICY wifi_devices_admin_manage
    ON public.wifi_devices
    FOR ALL TO authenticated
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

-- Aucun utilisateur non admin ne peut lire ni modifier les mots de passe.
ALTER TABLE public.wifi_device_secrets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wifi_device_secrets TO authenticated;

DROP POLICY IF EXISTS wifi_device_secrets_admin_only ON public.wifi_device_secrets;
CREATE POLICY wifi_device_secrets_admin_only
    ON public.wifi_device_secrets
    FOR ALL TO authenticated
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

-- Publier les changements en temps réel pour l'application.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'wifi_devices'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wifi_devices;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'wifi_device_secrets'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wifi_device_secrets;
    END IF;
END;
$$;

-- Créer la catégorie sans dupliquer une catégorie Wi-Fi existante.
UPDATE public.categories
SET shape = 'wifi'
WHERE lower(name) IN ('wi-fi', 'wifi')
  AND shape IS DISTINCT FROM 'wifi';

INSERT INTO public.categories (id, name, shape, position)
SELECT
    'cat-wifi',
    'Wi-Fi',
    'wifi',
    COALESCE((SELECT MAX(position) FROM public.categories), 0) + 1
WHERE NOT EXISTS (
    SELECT 1 FROM public.categories WHERE lower(name) IN ('wi-fi', 'wifi')
)
ON CONFLICT (id) DO NOTHING;
