-- Permisos mínimos del rol de aplicación (cielo_app). La API se conecta con
-- este rol, nunca con el dueño (doadmin), para que RLS se aplique siempre.
-- El rol se crea desde el panel de DigitalOcean; si no existe, no hace nada.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cielo_app') THEN
    GRANT USAGE ON SCHEMA public TO cielo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON empresas, miembros, documentos TO cielo_app;
  END IF;
END $$;
