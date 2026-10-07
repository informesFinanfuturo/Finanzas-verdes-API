BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM asesor
        WHERE id_asesor = 1
    ) THEN
        RAISE EXCEPTION
            'No existe el asesor con id_asesor = 1.';
    END IF;
END
$$;

INSERT INTO asesor_mipyme (
    id_asesor,
    id_mipyme
)
SELECT
    1,
    m.id_mipyme
FROM mipyme m
WHERE NOT EXISTS (
    SELECT 1
    FROM asesor_mipyme am
    WHERE am.id_mipyme = m.id_mipyme
)
ON CONFLICT (
    id_asesor,
    id_mipyme
)
DO NOTHING;

COMMIT;
