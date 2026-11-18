-- FVE integral V1: exclusiva base de pruebas finanzas_verdes_demo.
-- Ejecutar con psql -v app_role=<DB_USER> -v ON_ERROR_STOP=1 -f archivo.sql
\if :{?app_role}
\else
  \echo ERROR: Debe indicar -v app_role
  \quit 3
\endif
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'finanzas_verdes_demo' THEN
  RAISE EXCEPTION 'Migracion denegada: la base no es finanzas_verdes_demo';
 END IF;
 IF to_regclass('public.fve_proceso') IS NULL OR
    to_regclass('public.fve_seleccion_linea') IS NULL OR
    to_regclass('public.fve_evaluacion_activo') IS NULL THEN
  RAISE EXCEPTION 'Faltan migraciones FVE previas 00, 03 o 05';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.fve_propuesta_version (
  id_propuesta BIGSERIAL PRIMARY KEY,
  id_proceso INTEGER NOT NULL REFERENCES public.fve_proceso(id_proceso),
  numero_version INTEGER NOT NULL CHECK(numero_version>0),
  estado VARCHAR(20) NOT NULL CHECK(estado IN ('borrador','presentada')),
  detalle JSONB NOT NULL,
  total_inversion NUMERIC(18,0) NOT NULL CHECK(total_inversion>=0),
  pdf_bytes BYTEA,
  pdf_sha256 VARCHAR(64),
  created_by INTEGER NOT NULL REFERENCES public.usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  presented_at TIMESTAMPTZ,
  UNIQUE(id_proceso,numero_version),
  CONSTRAINT fve_propuesta_archivo_presentada CHECK (
    (estado='borrador' AND pdf_bytes IS NULL AND pdf_sha256 IS NULL) OR
    (estado='presentada' AND pdf_bytes IS NOT NULL AND pdf_sha256 IS NOT NULL AND presented_at IS NOT NULL)
  )
);
CREATE TABLE IF NOT EXISTS public.fve_decision_propuesta (
  id_decision BIGSERIAL PRIMARY KEY,
  id_propuesta BIGINT NOT NULL REFERENCES public.fve_propuesta_version(id_propuesta),
  decision VARCHAR(30) NOT NULL CHECK(decision IN ('interesado','suspendido','desinteresado')),
  observacion TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES public.usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fve_financiamiento_propuesta (
  id_financiamiento BIGSERIAL PRIMARY KEY,
  id_propuesta BIGINT NOT NULL UNIQUE REFERENCES public.fve_propuesta_version(id_propuesta),
  modalidad VARCHAR(30) NOT NULL CHECK(modalidad IN ('recursos_propios','credito_finanfuturo','mixta')),
  recursos_propios NUMERIC(18,0) NOT NULL CHECK(recursos_propios>=0),
  credito_solicitado NUMERIC(18,0) NOT NULL CHECK(credito_solicitado>=0),
  observacion TEXT NOT NULL DEFAULT '',
  updated_by INTEGER NOT NULL REFERENCES public.usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fve_viabilidad_propuesta (
  id_viabilidad BIGSERIAL PRIMARY KEY,
  id_propuesta BIGINT NOT NULL UNIQUE REFERENCES public.fve_propuesta_version(id_propuesta),
  estado VARCHAR(20) NOT NULL CHECK(estado IN ('viable','no_viable','pendiente')),
  recursos_propios_confirmados BOOLEAN NOT NULL DEFAULT FALSE,
  estado_credito VARCHAR(20) NOT NULL CHECK(estado_credito IN ('no_aplica','pendiente','aprobado','rechazado')),
  monto_credito_aprobado NUMERIC(18,0) NOT NULL DEFAULT 0 CHECK(monto_credito_aprobado>=0),
  referencia_soporte TEXT NOT NULL DEFAULT '',
  observacion TEXT NOT NULL DEFAULT '',
  updated_by INTEGER NOT NULL REFERENCES public.usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fve_cierre_negociacion (
  id_cierre BIGSERIAL PRIMARY KEY,
  id_proceso INTEGER NOT NULL UNIQUE REFERENCES public.fve_proceso(id_proceso),
  id_propuesta BIGINT NOT NULL REFERENCES public.fve_propuesta_version(id_propuesta),
  tipo_cierre VARCHAR(20) NOT NULL CHECK(tipo_cierre IN ('aceptada','desistida')),
  observacion TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES public.usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fve_evento_negociacion (
  id_evento BIGSERIAL PRIMARY KEY,
  id_proceso INTEGER NOT NULL REFERENCES public.fve_proceso(id_proceso),
  accion VARCHAR(80) NOT NULL,
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER NOT NULL REFERENCES public.usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_fve_prop_proceso ON public.fve_propuesta_version(id_proceso,numero_version DESC);
CREATE INDEX IF NOT EXISTS ix_fve_evento_proceso ON public.fve_evento_negociacion(id_proceso,id_evento DESC);
-- Impide que una propuesta PDF presentada se modifique o elimine, incluso con acceso SQL normal.
CREATE OR REPLACE FUNCTION public.fve_propuesta_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND OLD.estado='presentada' THEN
  RAISE EXCEPTION 'La propuesta presentada es inmutable';
 END IF;
 IF TG_OP='UPDATE' AND OLD.estado='presentada' THEN
  RAISE EXCEPTION 'La propuesta presentada es inmutable';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS trg_fve_propuesta_inmutable ON public.fve_propuesta_version;
CREATE TRIGGER trg_fve_propuesta_inmutable BEFORE UPDATE OR DELETE ON public.fve_propuesta_version
FOR EACH ROW EXECUTE FUNCTION public.fve_propuesta_inmutable();
-- Permisos limitados al modulo FVE para el usuario de la API.
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_role') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fve_seleccion_linea TO %I', :'app_role') \gexec
SELECT format('GRANT SELECT ON TABLE public.fve_evaluacion_activo TO %I', :'app_role') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fve_propuesta_version, public.fve_decision_propuesta, public.fve_financiamiento_propuesta, public.fve_viabilidad_propuesta, public.fve_cierre_negociacion, public.fve_evento_negociacion TO %I', :'app_role') \gexec
SELECT format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO %I',
 s.relname, :'app_role')
FROM pg_class s JOIN pg_namespace ns ON ns.oid=s.relnamespace
WHERE ns.nspname='public' AND s.relkind='S' AND
s.oid IN (SELECT pg_get_serial_sequence('public.'||tab,'id_'||suffix)::regclass
FROM (VALUES('fve_propuesta_version','propuesta'),('fve_decision_propuesta','decision'),
 ('fve_financiamiento_propuesta','financiamiento'),('fve_viabilidad_propuesta','viabilidad'),
 ('fve_cierre_negociacion','cierre'),('fve_evento_negociacion','evento'),
 ('fve_seleccion_linea','linea')) x(tab,suffix)) \gexec
COMMIT;
