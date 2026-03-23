-- Migration: Add guest sender and recipient fields to packages
-- Fecha: 23 de Marzo, 2026

ALTER TABLE packages 
ADD COLUMN IF NOT EXISTS sender_name TEXT,
ADD COLUMN IF NOT EXISTS sender_phone TEXT,
ADD COLUMN IF NOT EXISTS recipient_name TEXT,
ADD COLUMN IF NOT EXISTS recipient_phone TEXT,
ADD COLUMN IF NOT EXISTS recipient_email TEXT;

-- Permitir que sender_id sea opcional para envíos de invitados
ALTER TABLE packages 
ALTER COLUMN sender_id DROP NOT NULL;

COMMENT ON COLUMN packages.sender_name IS 'Nombre del remitente (para casos de invitados sin cuenta)';
COMMENT ON COLUMN packages.sender_phone IS 'Teléfono de contacto del remitente';
COMMENT ON COLUMN packages.recipient_email IS 'Email del destinatario para notificaciones automáticas';
