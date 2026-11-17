-- Consola de super admin: suscripciones (plan, monto, renovación), pagos
-- registrados a mano, registro de errores de la plataforma y último acceso de
-- cada usuario. Nada de esto contiene datos de empleados.
--  · suscripciones y pagos: solo los lee y escribe el super admin.
--  · errores: cualquier sesión verificada puede REPORTAR uno (INSERT); solo el
--    super admin los lee, marca o purga.

ALTER TABLE miembros ADD COLUMN IF NOT EXISTS ultimo_acceso timestamptz;

CREATE TABLE suscripciones (
  empresa_id       uuid PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  plan             text NOT NULL DEFAULT '' CHECK (length(plan) <= 80),
  monto            numeric(12,2) NOT NULL DEFAULT 0 CHECK (monto >= 0),
  ciclo            text NOT NULL DEFAULT 'mensual' CHECK (ciclo IN ('mensual','anual')),
  fecha_renovacion date,
  notas            text NOT NULL DEFAULT '' CHECK (length(notas) <= 500),
  actualizado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pagos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  monto         numeric(12,2) NOT NULL CHECK (monto > 0),
  fecha_pago    date NOT NULL,
  metodo        text NOT NULL DEFAULT 'transferencia' CHECK (metodo IN ('transferencia','efectivo','tarjeta','cheque','otro')),
  referencia    text NOT NULL DEFAULT '' CHECK (length(referencia) <= 120),
  nota          text NOT NULL DEFAULT '' CHECK (length(nota) <= 300),
  anulado       boolean NOT NULL DEFAULT false,
  registrado_por text,
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pagos_empresa_idx ON pagos (empresa_id, fecha_pago DESC);

CREATE TABLE errores (
  id          bigserial PRIMARY KEY,
  huella      text NOT NULL,
  origen      text NOT NULL CHECK (origen IN ('web','api')),
  mensaje     text NOT NULL CHECK (length(mensaje) <= 500),
  detalle     text NOT NULL DEFAULT '' CHECK (length(detalle) <= 3000),
  ruta        text NOT NULL DEFAULT '' CHECK (length(ruta) <= 200),
  empresa_id  uuid REFERENCES empresas(id) ON DELETE SET NULL,
  uid         text,
  resuelto    boolean NOT NULL DEFAULT false,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX errores_huella_idx ON errores (huella, creado_en DESC);
CREATE INDEX errores_fecha_idx ON errores (creado_en DESC);

ALTER TABLE suscripciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE errores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE suscripciones FORCE ROW LEVEL SECURITY;
ALTER TABLE pagos         FORCE ROW LEVEL SECURITY;
ALTER TABLE errores       FORCE ROW LEVEL SECURITY;

CREATE POLICY suscripciones_super ON suscripciones
  USING (current_setting('app.superadmin', true) = 'on')
  WITH CHECK (current_setting('app.superadmin', true) = 'on');
CREATE POLICY pagos_super ON pagos
  USING (current_setting('app.superadmin', true) = 'on')
  WITH CHECK (current_setting('app.superadmin', true) = 'on');

CREATE POLICY errores_reportar ON errores FOR INSERT
  WITH CHECK (coalesce(current_setting('app.uid', true), '') <> '');
CREATE POLICY errores_leer ON errores FOR SELECT
  USING (current_setting('app.superadmin', true) = 'on');
CREATE POLICY errores_marcar ON errores FOR UPDATE
  USING (current_setting('app.superadmin', true) = 'on')
  WITH CHECK (current_setting('app.superadmin', true) = 'on');
CREATE POLICY errores_purgar ON errores FOR DELETE
  USING (current_setting('app.superadmin', true) = 'on');

REVOKE ALL ON suscripciones, pagos, errores FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cielo_app') THEN
    GRANT SELECT, INSERT, UPDATE ON suscripciones TO cielo_app;
    GRANT SELECT, INSERT, UPDATE ON pagos TO cielo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON errores TO cielo_app;
    GRANT USAGE ON SEQUENCE errores_id_seq TO cielo_app;
  END IF;
END $$;
