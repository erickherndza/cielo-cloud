-- Roles de acceso (2026-11-26): se agregan «analista» y «auxiliar». Los anteriores (gerente, rrhh, contador)
-- se CONSERVAN en el CHECK: la API los trata como «analista» (alias), así no hace falta convertir datos y el
-- orden migración → API → web no puede dejar a nadie sin acceso. Una limpieza posterior puede quitarlos.
ALTER TABLE miembros      DROP CONSTRAINT IF EXISTS miembros_rol_check;
ALTER TABLE miembros      ADD  CONSTRAINT miembros_rol_check
  CHECK (rol IN ('admin','analista','auxiliar','gerente','rrhh','contador'));
ALTER TABLE invitaciones  DROP CONSTRAINT IF EXISTS invitaciones_rol_check;
ALTER TABLE invitaciones  ADD  CONSTRAINT invitaciones_rol_check
  CHECK (rol IN ('admin','analista','auxiliar','gerente','rrhh','contador'));
