-- Этап 2.1: сделки amo, отправки, сопоставление товаров, складские документы.

CREATE TABLE IF NOT EXISTS deals (
    id              BIGINT PRIMARY KEY,            -- ID сделки в amoCRM
    pipeline_id     BIGINT,
    status_id       BIGINT,
    name            TEXT,
    price_minor     BIGINT NOT NULL DEFAULT 0,
    customer_name   TEXT,
    customer_phone  TEXT,
    customer_email  TEXT,
    responsible_user_id BIGINT,
    fields          JSONB NOT NULL DEFAULT '{}'::jsonb,
    amo_updated_at  BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deal_items (
    id             BIGSERIAL PRIMARY KEY,
    deal_id        BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    amo_product_id BIGINT NOT NULL,
    name           TEXT,
    sku            TEXT,
    quantity       NUMERIC(12,3) NOT NULL DEFAULT 1,
    price_minor    BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_deal_items_deal ON deal_items (deal_id);

-- Одна сделка — одна отправка.
CREATE TABLE IF NOT EXISTS shipments (
    deal_id       BIGINT PRIMARY KEY REFERENCES deals(id) ON DELETE CASCADE,
    method        VARCHAR(20),                     -- cdek | karaganda
    country       VARCHAR(2),                      -- KZ | RU
    delivery_type VARCHAR(10),                     -- door | pvz
    city          TEXT,
    address       TEXT,
    pvz_code      TEXT,
    address_hash  VARCHAR(64),
    state         VARCHAR(20) NOT NULL DEFAULT 'new',
    cdek_uuid     VARCHAR(64),
    cdek_number   VARCHAR(64),
    cdek_status   VARCHAR(80),
    cdek_status_at TIMESTAMPTZ,
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_cdek_uuid ON shipments (cdek_uuid) WHERE cdek_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_state ON shipments (state);

-- Справочник товаров IIKO (мастер-справочник), наполняется connectors/iiko/sync-menu.js.
CREATE TABLE IF NOT EXISTS external_products (
    id              BIGSERIAL PRIMARY KEY,
    external_system VARCHAR(20) NOT NULL,
    external_id     VARCHAR(64) NOT NULL,
    name            TEXT,
    sku             TEXT,
    category_name   TEXT,
    price_raw       NUMERIC(14,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (external_system, external_id)
);

-- Товары и остатки фулфилмента СДЭК (Orderadmin), наполняется cron-скриптом sync-stock.js.
CREATE TABLE IF NOT EXISTS ff_offers (
    external_id VARCHAR(64) PRIMARY KEY,
    name        TEXT,
    sku         TEXT,
    article     TEXT,
    stock       NUMERIC(12,3),
    price_minor BIGINT,
    currency    VARCHAR(8),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Сопоставление: позиция каталога amo ↔ товар IIKO ↔ SKU фулфилмента ↔ карточка 1С.
CREATE TABLE IF NOT EXISTS product_map (
    amo_product_id  BIGINT PRIMARY KEY,
    amo_name        TEXT,
    iiko_product_id VARCHAR(64),
    iiko_unit_id    VARCHAR(64),
    cdek_sku        TEXT,
    weight_g        INTEGER,
    onec_ref        VARCHAR(64),
    note            TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Документы, созданные по отправке: списание и приход в IIKO, реализация и возврат в 1С.
CREATE TABLE IF NOT EXISTS stock_documents (
    id          BIGSERIAL PRIMARY KEY,
    deal_id     BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    kind        VARCHAR(20) NOT NULL,              -- writeoff | sale | return_iiko | return_1c
    op_key      VARCHAR(120) NOT NULL UNIQUE,      -- deal:{id}:writeoff и т. п.
    system      VARCHAR(10) NOT NULL,              -- iiko | 1c
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | done | skipped | failed
    external_id TEXT,
    detail      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_docs_deal ON stock_documents (deal_id);
