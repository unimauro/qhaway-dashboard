-- 001_pre2012.sql — idempotente. Se puede correr N veces (load.py la aplica en cada arranque).
--
-- Diagnóstico: las filas <2012 de gasto_nacional y gasto_depto_hist NO vienen del CSV del MEF
-- (load.py solo carga 2012+). Las inserta load_json.py desde public/data/serie-historica-oficial.json
-- y por-departamento-historico.json, que generó etl/scraper_consulta_amigable.py desde la
-- Consulta Amigable. Para años <2012 esa tabla trae MENOS columnas (no tiene Compromiso Anual ni
-- Atención Mensual), pero el scraper tomaba posiciones fijas: nums[2] (Compromiso) → "certificado",
-- nums[5] (Avance %) → "devengado" y, al haber solo 6 números, también → "girado".
-- Por eso devengado = girado = 85–110 por departamento (un porcentaje) y la serie nacional
-- (suma de deptos) da ~2 000–4 500 «soles»; y en 2004 «certificado» (compromiso) > PIM.
-- 2005 está además desalineado (PIA = 0 en todos los deptos, PIM ≪ «certificado»).
--
-- Decisión (prioridad 2021–2026): esta migración NO modifica ni borra datos. La API ya oculta
-- certificado/devengado/girado para ano<2012 (devuelve null) y omite las filas de 2005 con PIA 0.
-- Solo deja una vista auditable de lo que se considera inválido.
CREATE TABLE IF NOT EXISTS carga_log (
  id BIGSERIAL PRIMARY KEY,
  ano INT NOT NULL,
  fuente_url TEXT,
  last_modified TIMESTAMPTZ,
  filas BIGINT,
  cargado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_carga_log_ano ON carga_log(ano, cargado_en DESC);

CREATE OR REPLACE VIEW v_pre2012_invalido AS
  SELECT 'gasto_nacional' AS tabla, ano, NULL::text AS ubigeo, pia, pim, certificado, devengado, girado
    FROM gasto_nacional WHERE ano < 2012
  UNION ALL
  SELECT 'gasto_depto_hist', ano, ubigeo, pia, pim, certificado, devengado, girado
    FROM gasto_depto_hist WHERE ano < 2012;

-- La limpieza destructiva (NULL en <2012 y borrado de 2005) está aparte, para correr a mano
-- cuando se decida: server/loader/manual/001b_pre2012_limpieza.sql (NO se aplica automáticamente).
