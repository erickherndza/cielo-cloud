-- Endurecimiento: historial de versiones (recuperar de un error o de un
-- guardado equivocado), timeouts de consulta y permisos mínimos.

CREATE TABLE documentos_historial (
  empresa_id      uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  coleccion       text NOT NULL,
  version         integer NOT NULL,
  datos           jsonb NOT NULL,
  actualizado_en  timestamptz NOT NULL,
  actualizado_por text,
  archivado_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, coleccion, version)
);

ALTER TABLE documentos_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_historial FORCE ROW LEVEL SECURITY;
CREATE POLICY historial_acceso ON documentos_historial
  USING (empresa_id::text = current_setting('app.empresa_id', true))
  WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true));

REVOKE ALL ON documentos_historial FROM PUBLIC;
-- Nadie más que el dueño puede crear objetos en `public`.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cielo_app') THEN
    GRANT SELECT, INSERT, DELETE ON documentos_historial TO cielo_app;
    -- Una consulta runaway o una transacción colgada no puede tumbar la base.
    ALTER ROLE cielo_app SET statement_timeout = '20s';
    ALTER ROLE cielo_app SET idle_in_transaction_session_timeout = '15s';
  END IF;
END $$;
