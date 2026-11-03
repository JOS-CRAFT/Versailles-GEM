-- GEM: prise en charge des baies et des machines qu'elles contiennent.
-- À exécuter une seule fois dans Supabase > SQL Editor.

-- Les modèles de matériel partagent le catalogue existant, avec un type explicite.
ALTER TABLE public.speaker_types
    ADD COLUMN IF NOT EXISTS equipment_kind text NOT NULL DEFAULT 'speaker';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'speaker_types_equipment_kind_check'
          AND conrelid = 'public.speaker_types'::regclass
    ) THEN
        ALTER TABLE public.speaker_types
            ADD CONSTRAINT speaker_types_equipment_kind_check
            CHECK (equipment_kind IN ('speaker', 'machine'));
    END IF;
END;
$$;

-- Chaque point de type Baie stocke la liste des modèles et leurs quantités.
ALTER TABLE public.locations
    ADD COLUMN IF NOT EXISTS bay_machines jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'locations_bay_machines_array_check'
          AND conrelid = 'public.locations'::regclass
    ) THEN
        ALTER TABLE public.locations
            ADD CONSTRAINT locations_bay_machines_array_check
            CHECK (jsonb_typeof(bay_machines) = 'array');
    END IF;
END;
$$;

-- Le marqueur rack est réservé à la catégorie Baies.
ALTER TABLE public.categories
    DROP CONSTRAINT IF EXISTS categories_shape_check;

ALTER TABLE public.categories
    ADD CONSTRAINT categories_shape_check
    CHECK (shape IN ('circle', 'square', 'diamond', 'triangle', 'hexagon', 'octagon', 'rack'));

UPDATE public.categories
SET shape = 'rack'
WHERE lower(name) = lower('Baies')
  AND shape IS DISTINCT FROM 'rack';

INSERT INTO public.categories (id, name, shape, position)
SELECT
    'cat-baies',
    'Baies',
    'rack',
    COALESCE((SELECT MAX(position) FROM public.categories), 0) + 1
WHERE NOT EXISTS (
    SELECT 1 FROM public.categories WHERE lower(name) = lower('Baies')
)
ON CONFLICT (id) DO NOTHING;
