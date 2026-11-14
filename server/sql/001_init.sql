-- Cielo Cloud Nómina — esquema inicial (fase 1)
-- Aislamiento por empresa con Row Level Security: la API fija en cada
-- transacción app.uid y app.empresa_id; ninguna consulta ve filas de otra empresa.

CREATE TABLE empresas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       text NOT NULL DEFAULT '',
  owner_uid    text NOT NULL,
  creado_en    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE miembros (
  empresa_id   uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  uid          text NOT NULL,
  email        text,
  rol          text NOT NULL CHECK (rol IN ('admin','gerente','rrhh','contador')),
  creado_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, uid)
);
CREATE INDEX miembros_uid_idx ON miembros (uid);

-- Una fila por colección (empleados, periodos, prestamos...) y empresa.
-- `version` permite detectar escrituras concurrentes (409) en vez de pisarlas.
CREATE TABLE documentos (
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  coleccion      text NOT NULL,
  datos          jsonb NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por text,
  PRIMARY KEY (empresa_id, coleccion)
);

ALTER TABLE empresas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE miembros   ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos ENABLE ROW LEVEL SECURITY;
-- FORCE: el dueño de la tabla también queda sujeto a las políticas.
ALTER TABLE empresas   FORCE ROW LEVEL SECURITY;
ALTER TABLE miembros   FORCE ROW LEVEL SECURITY;
ALTER TABLE documentos FORCE ROW LEVEL SECURITY;

CREATE POLICY empresas_acceso ON empresas
  USING (id::text = current_setting('app.empresa_id', true)
         OR owner_uid = current_setting('app.uid', true))
  WITH CHECK (owner_uid = current_setting('app.uid', true));

CREATE POLICY miembros_acceso ON miembros
  USING (uid = current_setting('app.uid', true)
         OR empresa_id::text = current_setting('app.empresa_id', true))
  WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true)
              OR uid = current_setting('app.uid', true));

CREATE POLICY documentos_acceso ON documentos
  USING (empresa_id::text = current_setting('app.empresa_id', true))
  WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true));
