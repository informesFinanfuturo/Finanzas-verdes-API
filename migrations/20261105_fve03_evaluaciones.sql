-- ENTREGA 03. Ejecutar SOLO en finanzas_verdes_demo, despues de la migracion 02.
-- No modifica columnas ni registros de activo, diagnostico, item_catalogo o procesos previos.
BEGIN;

CREATE TABLE IF NOT EXISTS public.fve_motor_parametro (
  codigo_taxonomia VARCHAR(60) PRIMARY KEY REFERENCES public.fve_taxonomia_activo(codigo),
  umbral_ahorro NUMERIC(6,5) NOT NULL CHECK (umbral_ahorro > 0 AND umbral_ahorro < 1),
  banda_incertidumbre NUMERIC(6,5) NOT NULL CHECK (banda_incertidumbre >= 0 AND banda_incertidumbre < 1),
  dias_operacion_default SMALLINT NOT NULL DEFAULT 365 CHECK (dias_operacion_default BETWEEN 1 AND 366),
  version_parametro VARCHAR(80) NOT NULL,
  estado_aprobacion VARCHAR(30) NOT NULL DEFAULT 'provisional'
    CHECK (estado_aprobacion IN ('provisional', 'aprobado')),
  observacion TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Parametros iniciales de PRUEBA, sujetos a decisiones del piloto.
-- Para luminarias el valor puntual sigue al documento (confianza alta si se documenta uso).
INSERT INTO public.fve_motor_parametro
 (codigo_taxonomia, umbral_ahorro, banda_incertidumbre, dias_operacion_default,
  version_parametro, estado_aprobacion, observacion)
VALUES
 ('LUMINARIAS', 0.20, 0.00, 365, 'FVE03-PILOTO-V1', 'provisional',
  '20% armonizado para energia segun documento; declaracion ex ante puntual con horas y dias capturados.'),
 ('GRIFERIA', 0.20, 0.30, 365, 'FVE03-PILOTO-V1', 'provisional',
  '20% agua por activo; banda +/-30% y 365 dias si falta dato real: supuestos visibles sujetos a calibracion.'),
 ('REDUCTORES_CAUDAL', 0.20, 0.30, 365, 'FVE03-PILOTO-V1', 'provisional',
  'Dispositivo propuesto sobre griferia existente; banda +/-30%; dias operativos por defecto sujetos a ajuste.')
ON CONFLICT (codigo_taxonomia) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fve_evaluacion_activo (
  id_evaluacion BIGSERIAL PRIMARY KEY,
  id_proceso BIGINT NOT NULL REFERENCES public.fve_proceso(id_proceso),
  id_mipyme INTEGER NOT NULL REFERENCES public.mipyme(id_mipyme),
  id_activo INTEGER NOT NULL REFERENCES public.activo(id_activo),
  id_item INTEGER REFERENCES public.item_catalogo(id_item),
  codigo_taxonomia VARCHAR(60) NOT NULL REFERENCES public.fve_taxonomia_activo(codigo),
  version_taxonomia VARCHAR(100) NOT NULL,
  version_parametros VARCHAR(80) NOT NULL,
  version_motor VARCHAR(50) NOT NULL,
  estado VARCHAR(35) NOT NULL CHECK (estado IN
    ('elegible', 'no_elegible', 'no_alcanza_umbral', 'pendiente_dato', 'fuera_alcance')),
  cumplimiento_producto BOOLEAN,
  cumplimiento_ahorro BOOLEAN,
  consumo_anterior_anual NUMERIC(20,6),
  consumo_nuevo_anual NUMERIC(20,6),
  ahorro_anual_estimado NUMERIC(20,6),
  ahorro_porcentual_central NUMERIC(10,4),
  ahorro_porcentual_minimo NUMERIC(10,4),
  unidad VARCHAR(20) NOT NULL,
  datos_entrada JSONB NOT NULL,
  resultado JSONB NOT NULL,
  snapshot_taxonomia JSONB NOT NULL,
  apto_para_propuesta BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER NOT NULL REFERENCES public.usuario(id_usuario),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fve03_proceso_fecha
 ON public.fve_evaluacion_activo(id_proceso, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fve03_activo_fecha
 ON public.fve_evaluacion_activo(id_activo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fve03_mipyme_estado
 ON public.fve_evaluacion_activo(id_mipyme, estado);

COMMIT;
