-- =============================================================================
-- SIETE STICKER STUDIO - Esquema Relacional PostgreSQL (3FN)
-- Ejecutar en pgAdmin 4 o psql:
--   createdb siete_studio
--   psql -U postgres -d siete_studio -f database/schema_postgresql.sql
--   psql -U postgres -d siete_studio -f database/seed.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Función Trigger para actualizar updated_at automáticamente
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 1. ROLES (RBAC: admin, operador, cliente)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(30)  NOT NULL UNIQUE,
    name        VARCHAR(60)  NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_roles_code CHECK (code IN ('admin', 'operador', 'cliente'))
);

-- -----------------------------------------------------------------------------
-- 2. USERS (Enlazado a Firebase Auth mediante firebase_uid)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    firebase_uid   VARCHAR(128) NOT NULL UNIQUE,
    email          VARCHAR(255) NOT NULL UNIQUE,
    display_name   VARCHAR(120) NOT NULL,
    role_id        INTEGER      NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    email_verified BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    auth_provider  VARCHAR(50)  NOT NULL DEFAULT 'password',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_users_email_format CHECK (POSITION('@' IN email) > 1)
);

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. CUSTOMERS (Clientes / Referidos identificados por WhatsApp/teléfono)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id            SERIAL PRIMARY KEY,
    referral_name VARCHAR(120) NOT NULL,
    phone         VARCHAR(25)  NOT NULL UNIQUE,
    notes         TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_customers_name_len CHECK (CHAR_LENGTH(TRIM(referral_name)) >= 2)
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. MATERIALS (Catálogo administrable CRUD de sustratos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materials (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(80)    NOT NULL UNIQUE,
    description         TEXT,
    requires_gloss_mode BOOLEAN        NOT NULL DEFAULT FALSE,
    base_unit_price     NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    is_active           BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_materials_price CHECK (base_unit_price >= 0)
);

DROP TRIGGER IF EXISTS trg_materials_updated_at ON materials;
CREATE TRIGGER trg_materials_updated_at
    BEFORE UPDATE ON materials
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. SHAPES (Catálogo de formas de corte/troquelado)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shapes (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) NOT NULL UNIQUE,
    is_circular BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE
);

-- -----------------------------------------------------------------------------
-- 6. ORDERS (Pedidos de stickers y control financiero de ventas)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id                 SERIAL PRIMARY KEY,
    order_number       VARCHAR(30)    NOT NULL UNIQUE,
    customer_id        INTEGER        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    material_id        INTEGER        NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
    vinyl_gloss_mode   VARCHAR(30),
    shape_id           INTEGER        NOT NULL REFERENCES shapes(id) ON DELETE RESTRICT,
    diameter_cm        NUMERIC(6, 2),
    size_mode          VARCHAR(20),
    height_cm          NUMERIC(6, 2),
    width_cm           NUMERIC(6, 2),
    dimensions         VARCHAR(40),
    size_display       VARCHAR(50)    NOT NULL,
    quantity           INTEGER        NOT NULL,
    received_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    delivery_datetime  TIMESTAMPTZ    NOT NULL,
    status             VARCHAR(30)    NOT NULL DEFAULT 'Pendiente',
    total_price        NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    advance_payment    NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    pending_balance    NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    payment_method     VARCHAR(30)    NOT NULL DEFAULT 'Pendiente',
    notes              TEXT,
    source             VARCHAR(20)    NOT NULL DEFAULT 'public',
    created_by_user_id INTEGER        REFERENCES users(id) ON DELETE SET NULL,
    updated_by_user_id INTEGER        REFERENCES users(id) ON DELETE SET NULL,
    updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    -- Restricciones de dominio y reglas de negocio en SGBD
    CONSTRAINT chk_orders_gloss_mode CHECK (
        vinyl_gloss_mode IS NULL OR vinyl_gloss_mode IN ('En rollo', 'Corte uno a uno')
    ),
    CONSTRAINT chk_orders_size_xor CHECK (
        (diameter_cm IS NOT NULL AND dimensions IS NULL)
        OR (diameter_cm IS NULL AND dimensions IS NOT NULL)
    ),
    CONSTRAINT chk_orders_diameter_range CHECK (
        diameter_cm IS NULL OR (diameter_cm >= 0.5 AND diameter_cm <= 500)
    ),
    CONSTRAINT chk_orders_quantity CHECK (quantity >= 1 AND quantity <= 1000000),
    CONSTRAINT chk_orders_delivery_exact_hour CHECK (
        EXTRACT(MINUTE FROM delivery_datetime) = 0
        AND EXTRACT(SECOND FROM delivery_datetime) = 0
    ),
    CONSTRAINT chk_orders_status CHECK (
        status IN (
            'Pendiente', 'En Diseño', 'En Impresión',
            'Troquelado', 'Listo', 'Entregado', 'Cancelado'
        )
    ),
    CONSTRAINT chk_orders_money_non_negative CHECK (
        total_price >= 0 AND advance_payment >= 0 AND pending_balance >= 0
    ),
    CONSTRAINT chk_orders_advance_le_total CHECK (
        total_price = 0 OR advance_payment <= total_price
    ),
    CONSTRAINT chk_orders_pending_balance CHECK (
        pending_balance = GREATEST(0, total_price - advance_payment)
    ),
    CONSTRAINT chk_orders_payment_method CHECK (
        payment_method IN ('Pendiente', 'Efectivo', 'Transferencia', 'QR', 'Tarjeta', 'Mixto')
    ),
    CONSTRAINT chk_orders_source CHECK (source IN ('public', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_orders_delivery_datetime ON orders(delivery_datetime);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_material_id ON orders(material_id);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. ORDER_IMAGES (Relación 1:1 con metadatos del archivo validado)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_images (
    id                SERIAL PRIMARY KEY,
    order_id          INTEGER      NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    storage_path      VARCHAR(300) NOT NULL,
    safe_filename     VARCHAR(160) NOT NULL,
    original_filename VARCHAR(160) NOT NULL,
    content_type      VARCHAR(60)  NOT NULL,
    size_bytes        INTEGER      NOT NULL,
    uploaded_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_order_images_mime CHECK (
        content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')
    ),
    CONSTRAINT chk_order_images_size CHECK (size_bytes > 0 AND size_bytes <= 10485760)
);

-- -----------------------------------------------------------------------------
-- 7b. ORDER_ITEMS (Modelo Maestro-Detalle: N diseños de stickers por pedido)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
    id                      SERIAL PRIMARY KEY,
    order_id                INTEGER       NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    position                INTEGER       NOT NULL DEFAULT 1,
    material_id             INTEGER       NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
    vinyl_gloss_mode        VARCHAR(30),
    shape_id                INTEGER       NOT NULL REFERENCES shapes(id) ON DELETE RESTRICT,
    diameter_cm             NUMERIC(6, 2),
    size_mode               VARCHAR(20),
    height_cm               NUMERIC(6, 2),
    width_cm                NUMERIC(6, 2),
    dimensions              VARCHAR(40),
    size_display            VARCHAR(50)   NOT NULL,
    quantity                INTEGER       NOT NULL,
    image_storage_path      VARCHAR(300)  NOT NULL,
    image_safe_filename     VARCHAR(160)  NOT NULL,
    image_original_filename VARCHAR(160)  NOT NULL,
    image_content_type      VARCHAR(60)   NOT NULL,
    image_size_bytes        INTEGER       NOT NULL,
    image_uploaded_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    enhanced_storage_path   VARCHAR(300),
    die_cut_anchors_json    TEXT,
    die_cut_eps_path        VARCHAR(300),
    prepress_status         VARCHAR(30)   NOT NULL DEFAULT 'pendiente',

    CONSTRAINT uq_order_items_order_position UNIQUE (order_id, position),
    CONSTRAINT chk_order_items_position CHECK (position >= 1),
    CONSTRAINT chk_order_items_gloss_mode CHECK (
        vinyl_gloss_mode IS NULL OR vinyl_gloss_mode IN ('En rollo', 'Corte uno a uno')
    ),
    CONSTRAINT chk_order_items_size_xor CHECK (
        (diameter_cm IS NOT NULL AND dimensions IS NULL)
        OR (diameter_cm IS NULL AND dimensions IS NOT NULL)
    ),
    CONSTRAINT chk_order_items_diameter_range CHECK (
        diameter_cm IS NULL OR (diameter_cm >= 0.5 AND diameter_cm <= 500)
    ),
    CONSTRAINT chk_order_items_size_mode CHECK (
        size_mode IS NULL OR size_mode IN ('both', 'height_only', 'width_only')
    ),
    CONSTRAINT chk_order_items_height_range CHECK (
        height_cm IS NULL OR (height_cm >= 0.5 AND height_cm <= 500)
    ),
    CONSTRAINT chk_order_items_width_range CHECK (
        width_cm IS NULL OR (width_cm >= 0.5 AND width_cm <= 500)
    ),
    CONSTRAINT chk_order_items_quantity CHECK (quantity >= 1 AND quantity <= 1000000),
    CONSTRAINT chk_order_items_image_mime CHECK (
        image_content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')
    ),
    CONSTRAINT chk_order_items_image_size CHECK (
        image_size_bytes > 0 AND image_size_bytes <= 10485760
    ),
    CONSTRAINT chk_order_items_prepress_status CHECK (
        prepress_status IN ('pendiente', 'mejorado', 'troquelado', 'listo_pliego')
    )
);

-- Migración idempotente de columnas de preprensa y modo de medida no destructiva sobre bases existentes
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS size_mode VARCHAR(20);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS height_cm NUMERIC(6, 2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS width_cm NUMERIC(6, 2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS enhanced_storage_path VARCHAR(300);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS die_cut_anchors_json TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS die_cut_eps_path VARCHAR(300);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS prepress_status VARCHAR(30) NOT NULL DEFAULT 'pendiente';

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_material_id ON order_items(material_id);
CREATE INDEX IF NOT EXISTS idx_order_items_shape_id ON order_items(shape_id);

-- -----------------------------------------------------------------------------
-- 8. ORDER_STATUS_HISTORY (Bitácora auditable de cambios de estado)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_status_history (
    id                 SERIAL PRIMARY KEY,
    order_id           INTEGER     NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    previous_status    VARCHAR(30),
    new_status         VARCHAR(30) NOT NULL,
    changed_by_user_id INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    comment            TEXT,
    changed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON order_status_history(order_id);

-- -----------------------------------------------------------------------------
-- 9. PAYMENTS (Historial de abonos y pagos parciales/totales)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id                  SERIAL PRIMARY KEY,
    order_id            INTEGER        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    amount              NUMERIC(12, 2) NOT NULL,
    payment_method      VARCHAR(30)    NOT NULL,
    recorded_by_user_id INTEGER        REFERENCES users(id) ON DELETE SET NULL,
    reference           VARCHAR(120),
    recorded_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_payments_amount CHECK (amount > 0),
    CONSTRAINT chk_payments_method CHECK (
        payment_method IN ('Efectivo', 'Transferencia', 'QR', 'Tarjeta', 'Mixto')
    )
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);

COMMIT;
