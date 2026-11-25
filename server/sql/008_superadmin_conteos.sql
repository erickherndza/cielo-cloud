-- La consola de administración mostraba 0 empleados, 0 períodos y actividad «Nunca»
-- para todas las empresas. Causa: desde 005 la política de `documentos` exige
-- app.empresa_id, y las consultas de la consola (resumen, lista de empresas, usuarios)
-- no fijan ninguna empresa, así que RLS no les devolvía ninguna fila.
-- Se permite SOLO LECTURA a la sesión que la API marcó como super admin (tras verificar
-- el correo del token). La API solo devuelve conteos y fechas, nunca el contenido.
-- Escribir sigue exigiendo empresa activa y membresía.
CREATE POLICY documentos_superadmin_lectura ON documentos
  FOR SELECT
  USING (current_setting('app.superadmin', true) = 'on');
