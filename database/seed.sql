-- =============================================================================
-- SIETE STICKER STUDIO - Datos Iniciales (Seed Idempotente para PostgreSQL)
-- =============================================================================

BEGIN;

INSERT INTO roles (code, name, description) VALUES
    ('admin', 'Administrador', 'Control total del taller, usuarios, restauración de contraseñas, catálogos y ventas.'),
    ('operador', 'Operador de Taller', 'Gestión diaria de pedidos, producción, ventas y descargas de artes.'),
    ('cliente', 'Cliente', 'Acceso básico de seguimiento y gestión de cuenta personal.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO materials (name, description, requires_gloss_mode, base_unit_price, is_active) VALUES
    ('Vinilo Brillo', 'Acabado brillante impermeable y colores vibrantes. Requiere elegir En rollo o Corte uno a uno.', TRUE, 1.50, TRUE),
    ('Vinilo Mate', 'Superficie sedosa antirreflejo con tacto premium.', FALSE, 1.60, TRUE),
    ('Transparente', 'Base cristalina ideal para envases, vidrio y acrílico.', FALSE, 1.80, TRUE),
    ('DTF UV', 'Transfer con relieve táctil para superficies rígidas.', FALSE, 2.50, TRUE),
    ('Hojas Adhesivas', 'Papel autoadhesivo económico para empaques y etiquetas.', FALSE, 0.80, TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO shapes (name, is_circular, is_active) VALUES
    ('Circular', TRUE, TRUE),
    ('Rectangular', FALSE, TRUE),
    ('Cuadrado', FALSE, TRUE),
    ('En su forma', FALSE, TRUE)
ON CONFLICT (name) DO NOTHING;

COMMIT;
