-- 001b_pre2012_limpieza.sql — DESTRUCTIVA, NO se aplica sola (load.py solo aplica migraciones/*.sql).
-- Idempotente: guarda respaldo una vez, los UPDATE solo tocan filas aún no nulas y el DELETE de 2005
-- solo actúa si 2005 sigue incompleto (PIA total 0). Ver el diagnóstico en migraciones/001_pre2012.sql.
--   docker exec -i qhaway-db psql -U qhaway -d qhaway -v ON_ERROR_STOP=1 < /opt/qhaway-api/loader/manual/001b_pre2012_limpieza.sql
BEGIN;
CREATE TABLE IF NOT EXISTS backup_pre2012_nacional AS SELECT * FROM gasto_nacional WHERE ano < 2012;
CREATE TABLE IF NOT EXISTS backup_pre2012_depto AS SELECT * FROM gasto_depto_hist WHERE ano < 2012;
UPDATE gasto_nacional SET certificado = NULL, devengado = NULL, girado = NULL
 WHERE ano < 2012 AND (certificado IS NOT NULL OR devengado IS NOT NULL OR girado IS NOT NULL);
UPDATE gasto_depto_hist SET certificado = NULL, devengado = NULL, girado = NULL
 WHERE ano < 2012 AND (certificado IS NOT NULL OR devengado IS NOT NULL OR girado IS NOT NULL);
DELETE FROM gasto_depto_hist WHERE ano = 2005
   AND (SELECT COALESCE(SUM(pia), 0) FROM gasto_depto_hist WHERE ano = 2005) = 0;
DELETE FROM gasto_nacional WHERE ano = 2005 AND COALESCE(pia, 0) = 0;
COMMIT;
