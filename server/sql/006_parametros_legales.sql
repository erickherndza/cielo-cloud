-- Parámetros legales globales (días de cesantía, preaviso, vacaciones, divisor
-- del salario diario, qué prestaciones genera cada motivo de terminación).
-- Los edita solo el super admin; cada cambio es una versión nueva con motivo y
-- autor (la tabla solo admite INSERT: el historial no se reescribe). Si la tabla
-- está vacía, la aplicación usa los valores por defecto de su código.
-- No lleva datos de ninguna empresa: son reglas de ley, iguales para todas.

CREATE TABLE parametros_legales (
  version    integer PRIMARY KEY,
  datos      jsonb NOT NULL,
  motivo     text NOT NULL CHECK (length(motivo) BETWEEN 5 AND 300),
  uid        text NOT NULL,
  email      text,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE parametros_legales ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametros_legales FORCE ROW LEVEL SECURITY;

-- Lee cualquier sesión con usuario fijado por la API; escribe solo el super admin.
CREATE POLICY parametros_legales_lectura ON parametros_legales FOR SELECT
  USING (coalesce(current_setting('app.uid', true), '') <> '');
CREATE POLICY parametros_legales_escritura ON parametros_legales FOR INSERT
  WITH CHECK (current_setting('app.superadmin', true) = 'on');

REVOKE ALL ON parametros_legales FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cielo_app') THEN
    GRANT SELECT, INSERT ON parametros_legales TO cielo_app;
  END IF;
END $$;
