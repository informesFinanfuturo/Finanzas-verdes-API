BEGIN;

-- Solo metadato adicional de la visita. No modifica calificaciones ni historicos.
ALTER TABLE public.fve_visita_ambiental
  ADD COLUMN IF NOT EXISTS justificaciones_bloques jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
