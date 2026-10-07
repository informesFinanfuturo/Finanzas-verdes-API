BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM asesor_mipyme
        GROUP BY id_asesor, id_mipyme
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'No se puede crear la restriccion unica en asesor_mipyme: existen relaciones duplicadas.';
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_asesor_mipyme_unique
    ON asesor_mipyme (id_asesor, id_mipyme);

COMMIT;
