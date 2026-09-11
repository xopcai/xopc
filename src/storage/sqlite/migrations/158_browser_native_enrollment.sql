ALTER TABLE device_pairing_sessions ADD COLUMN enrollment_issuer TEXT;
ALTER TABLE device_pairing_sessions ADD COLUMN enrollment_extension_id TEXT;
ALTER TABLE device_pairing_sessions ADD COLUMN enrollment_public_key_thumbprint TEXT;
ALTER TABLE device_pairing_sessions ADD COLUMN enrollment_nonce TEXT;
