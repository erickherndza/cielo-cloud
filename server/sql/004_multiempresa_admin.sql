-- Multiempresa con super admin: la empresa se identifica por su RNC, el super
-- admin (definido por variable del servidor, nunca en esta base) administra
-- todas, y todo acceso suyo a datos ajenos queda en `accesos_log`.
-- El super admin NO tiene un permiso fijo en la base: la API fija
-- app.superadmin='on' en la transacción solo si el correo verificado del token
-- está en SUPERADMIN_EMAILS.

ALTER TABLE empresas
  ADD COLUMN rnc    text CHECK (rnc ~ '^([0-9]{9}|[0-9]{11})$'),
  ADD COLUMN estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','suspendida'));
CREATE UNIQUE INDEX empresas_rnc_uq ON empresas (rnc) WHERE rnc IS NOT NULL;

CREATE TABLE invitaciones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (email = lower(email)),
  rol         text NOT NULL CHECK (rol IN ('admin','gerente','rrhh','contador')),
  estado      text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aceptada','revocada')),
  creado_por  text NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  expira_en   timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE UNIQUE INDEX invitaciones_pendiente_uq ON invitaciones (empresa_id, email) WHERE estado = 'pendiente';
CREATE INDEX invitaciones_email_idx ON invitaciones (email);

CREATE TABLE accesos_log (
  id          bigserial PRIMARY KEY,
  empresa_id  uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  uid         text NOT NULL,
  email       text,
  accion      text NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accesos_log_empresa_idx ON accesos_log (empresa_id, creado_en DESC);

ALTER TABLE invitaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE accesos_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitaciones FORCE ROW LEVEL SECURITY;
ALTER TABLE accesos_log  FORCE ROW LEVEL SECURITY;

-- Una invitación la ve el super admin, la empresa dueña y la persona invitada
-- (por su correo verificado, fijado por la API en app.email).
CREATE POLICY invitaciones_acceso ON invitaciones
  USING (current_setting('app.superadmin', true) = 'on'
         OR empresa_id::text = current_setting('app.empresa_id', true)
         OR email = lower(current_setting('app.email', true)))
  WITH CHECK (current_setting('app.superadmin', true) = 'on'
              OR empresa_id::text = current_setting('app.empresa_id', true)
              OR email = lower(current_setting('app.email', true)));

-- El historial de accesos solo lo lee y escribe el super admin.
CREATE POLICY accesos_log_acceso ON accesos_log
  USING (current_setting('app.superadmin', true) = 'on')
  WITH CHECK (current_setting('app.superadmin', true) = 'on');

-- Las políticas existentes ganan la rama de super admin.
DROP POLICY empresas_acceso ON empresas;
CREATE POLICY empresas_acceso ON empresas
  USING (id::text = current_setting('app.empresa_id', true)
         OR owner_uid = current_setting('app.uid', true)
         OR current_setting('app.superadmin', true) = 'on'
         OR EXISTS (SELECT 1 FROM miembros m WHERE m.empresa_id = empresas.id AND m.uid = current_setting('app.uid', true)))
  WITH CHECK (owner_uid = current_setting('app.uid', true)
              OR current_setting('app.superadmin', true) = 'on');

DROP POLICY miembros_acceso ON miembros;
CREATE POLICY miembros_acceso ON miembros
  USING (uid = current_setting('app.uid', true)
         OR empresa_id::text = current_setting('app.empresa_id', true)
         OR current_setting('app.superadmin', true) = 'on')
  WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true)
              OR uid = current_setting('app.uid', true)
              OR current_setting('app.superadmin', true) = 'on');

DROP POLICY documentos_acceso ON documentos;
CREATE POLICY documentos_acceso ON documentos
  USING (empresa_id::text = current_setting('app.empresa_id', true))
  WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true));
-- (documentos e historial siguen exigiendo empresa_id explícito: el super admin
--  entra a una empresa concreta por la API, que fija app.empresa_id y registra el acceso.)

REVOKE ALL ON invitaciones, accesos_log FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cielo_app') THEN
    GRANT SELECT, INSERT, UPDATE ON invitaciones TO cielo_app;
    GRANT SELECT, INSERT ON accesos_log TO cielo_app;
    GRANT USAGE ON SEQUENCE accesos_log_id_seq TO cielo_app;
  END IF;
END $$;
