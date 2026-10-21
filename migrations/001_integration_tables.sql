-- ТАБЛИЦА ОЧЕРЕДИ
CREATE TABLE IF NOT EXISTS integration_queue (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    source VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    operation_key VARCHAR(255) UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_queue_status_priority 
    ON integration_queue(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_queue_operation_key 
    ON integration_queue(operation_key);

-- ТАБЛИЦА ЛОГОВ
CREATE TABLE IF NOT EXISTS integration_logs (
    id BIGSERIAL PRIMARY KEY,
    queue_id BIGINT REFERENCES integration_queue(id) ON DELETE CASCADE,
    level VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ТАБЛИЦА МАППИНГА ВНЕШНИХ ID
CREATE TABLE IF NOT EXISTS external_id_mapping (
    id BIGSERIAL PRIMARY KEY,
    internal_table VARCHAR(100) NOT NULL,
    internal_id INTEGER NOT NULL,
    external_system VARCHAR(50) NOT NULL,
    external_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(internal_table, internal_id, external_system)
);

CREATE INDEX IF NOT EXISTS idx_external_mapping 
    ON external_id_mapping(external_system, external_id);
CREATE INDEX IF NOT EXISTS idx_internal_mapping 
    ON external_id_mapping(internal_table, internal_id);

-- IIKO order id
ALTER TABLE orders ADD COLUMN IF NOT EXISTS iiko_order_id VARCHAR(64);

-- Расширение OrderStatus для IIKO
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'ready';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'delivering';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'delivered';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'completed';

-- ─────────────────────────────────────────────
-- Fulfillment
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fulfillment_orders (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    fulfillment_id VARCHAR(64),
    status VARCHAR(64),
    status_code VARCHAR(16),
    warehouse VARCHAR(128),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS fulfillment_orders_fulfillment_id_idx
    ON fulfillment_orders(fulfillment_id);

-- ─────────────────────────────────────────────
-- Marketplace (Ozon, WB, Kaspi)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_orders (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    marketplace VARCHAR(32) NOT NULL,
    marketplace_order_id VARCHAR(64),
    status VARCHAR(64),
    total_amount_minor INTEGER,
    currency VARCHAR(8),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(marketplace, marketplace_order_id)
);
CREATE INDEX IF NOT EXISTS marketplace_orders_marketplace_idx
    ON marketplace_orders(marketplace);

-- ─────────────────────────────────────────────
-- 1С
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onec_orders (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    onec_id VARCHAR(64),
    status VARCHAR(64),
    total_amount_minor INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS onec_orders_onec_id_idx
    ON onec_orders(onec_id);

-- ─────────────────────────────────────────────
-- МойСклад
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moysklad_products (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(64),
    name VARCHAR(255),
    sku VARCHAR(64),
    price_minor INTEGER,
    stock INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(external_id)
);
CREATE INDEX IF NOT EXISTS moysklad_products_external_id_idx
    ON moysklad_products(external_id);
