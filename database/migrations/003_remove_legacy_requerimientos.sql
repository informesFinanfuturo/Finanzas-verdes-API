BEGIN;

-- Elimina asignaciones del permiso obsoleto.
DELETE FROM permiso_rol
WHERE id_permiso IN (
    SELECT id_permiso
    FROM permiso
    WHERE LOWER(nombre) = LOWER('Crear requerimiento')
);

-- Elimina el permiso obsoleto.
DELETE FROM permiso
WHERE LOWER(nombre) = LOWER('Crear requerimiento');

-- Limpia auditoria asociada exclusivamente al modelo retirado.
DELETE FROM audit_log
WHERE LOWER(COALESCE(entidad, '')) IN (
    'requerimiento',
    'oferta',
    'compra',
    'oferta_archivo',
    'compra_archivo'
);

-- Elimina primero tablas hijas.
DROP TABLE IF EXISTS compra_archivo;
DROP TABLE IF EXISTS oferta_archivo;

-- Luego tablas dependientes.
DROP TABLE IF EXISTS compra;
DROP TABLE IF EXISTS oferta;

-- Finalmente la tabla principal legacy.
DROP TABLE IF EXISTS requerimiento;

-- Limpieza defensiva de secuencias antiguas.
DROP SEQUENCE IF EXISTS compra_archivo_id_compra_archivo_seq;
DROP SEQUENCE IF EXISTS oferta_archivo_id_oferta_archivo_seq;
DROP SEQUENCE IF EXISTS compra_id_compra_seq;
DROP SEQUENCE IF EXISTS oferta_id_oferta_seq;
DROP SEQUENCE IF EXISTS requerimiento_id_requerimiento_seq;

COMMIT;
