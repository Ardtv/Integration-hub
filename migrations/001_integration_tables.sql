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
