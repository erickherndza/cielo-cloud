-- Segunda barrera de aislamiento: hasta ahora la política de `documentos` y de
-- su historial dependía solo de app.empresa_id, que la API fija a partir de la
-- URL. Si una ruta olvidara comprobar la membresía, RLS no la detendría.
-- Desde aquí la base exige además que app.uid sea miembro de esa empresa (o
-- que la API haya fijado app.superadmin tras verificar el correo del token).

DROP POLICY documentos_acceso ON documentos;
CREATE POLICY documentos_acceso ON documentos
  USING (empresa_id::text = current_setting('app.empresa_id', true)
         AND (current_setting('app.superadmin', true) = 'on'
              OR EXISTS (SELECT 1 FROM miembros m
                          WHERE m.empresa_id = documentos.empresa_id
                            AND m.uid = current_setting('app.uid', true))))
  WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true)
         AND (current_setting('app.superadmin', true) = 'on'
              OR EXISTS (SELECT 1 FROM miembros m
                          WHERE m.empresa_id = documentos.empresa_id
                            AND m.uid = current_setting('app.uid', true))));

DROP POLICY historial_acceso ON documentos_historial;
CREATE POLICY historial_acceso ON documentos_historial
  USING (empresa_id::text = current_setting('app.empresa_id', true)
         AND (current_setting('app.superadmin', true) = 'on'
              OR EXISTS (SELECT 1 FROM miembros m
                          WHERE m.empresa_id = documentos_historial.empresa_id
                            AND m.uid = current_setting('app.uid', true))))
  WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true)
         AND (current_setting('app.superadmin', true) = 'on'
              OR EXISTS (SELECT 1 FROM miembros m
                          WHERE m.empresa_id = documentos_historial.empresa_id
                            AND m.uid = current_setting('app.uid', true))));

-- Permisos mínimos: ninguna ruta borra empresas ni colecciones vigentes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cielo_app') THEN
    REVOKE DELETE ON empresas, documentos FROM cielo_app;
  END IF;
END $$;
