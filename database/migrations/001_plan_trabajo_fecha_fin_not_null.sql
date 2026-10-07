BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM plan_trabajo
        WHERE fecha_fin IS NULL
    ) THEN
        RAISE EXCEPTION
            'No se puede establecer plan_trabajo.fecha_fin como NOT NULL: existen registros con fecha_fin NULL.';
    END IF;
END
$$;

ALTER TABLE plan_trabajo
    ALTER COLUMN fecha_fin SET NOT NULL;

COMMIT;
