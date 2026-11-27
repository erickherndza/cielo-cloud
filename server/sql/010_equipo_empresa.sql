-- El administrador de una empresa gestiona su equipo (invitar, cambiar rol, quitar). Esas acciones
-- quedan en accesos_log, que hasta ahora solo escribía el super admin. La LECTURA sigue siendo solo
-- del super admin; aquí solo se permite INSERTAR filas de la propia empresa y a nombre del propio usuario.
CREATE POLICY accesos_log_equipo ON accesos_log FOR INSERT
  WITH CHECK (empresa_id::text = current_setting('app.empresa_id', true)
              AND uid = current_setting('app.uid', true));
