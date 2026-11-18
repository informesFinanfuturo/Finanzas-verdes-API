-- Solo en la base local finanzas_verdes_demo. No modifica diagnosticos historicos.
BEGIN;
ALTER TABLE public.fve_proceso
  ADD COLUMN IF NOT EXISTS version_flujo SMALLINT;
ALTER TABLE public.fve_proceso
  ALTER COLUMN version_flujo SET DEFAULT 8;
-- Las negociaciones que aun estaban en el segundo paso son compatibles
-- con el flujo nuevo. No se reinterpretan otros avances historicos.
UPDATE public.fve_proceso SET version_flujo=8
WHERE version_flujo IS NULL AND paso_actual=2;
CREATE TABLE IF NOT EXISTS public.fve_seleccion_linea (
  id_linea BIGSERIAL PRIMARY KEY,
  id_proceso INTEGER NOT NULL REFERENCES public.fve_proceso(id_proceso),
  id_activo INTEGER NOT NULL REFERENCES public.activo(id_activo),
  id_item INTEGER NULL REFERENCES public.item_catalogo(id_item),
  cantidad INTEGER NOT NULL DEFAULT 1 CHECK(cantidad BETWEEN 1 AND 10000),
  origen TEXT NOT NULL DEFAULT 'asesor_fve',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER NOT NULL REFERENCES public.usuario(id_usuario),
  CONSTRAINT fve_seleccion_linea_unica UNIQUE(id_proceso,id_activo)
);
CREATE INDEX IF NOT EXISTS ix_fve_seleccion_item ON public.fve_seleccion_linea(id_item);
COMMIT;
