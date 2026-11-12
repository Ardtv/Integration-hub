-- Ядро хаба: очередь событий, журнал, исходящие вызовы.
-- База хаба отдельная от мини-аппы: таблиц orders/users здесь нет.

CREATE TABLE IF NOT EXISTS integration_queue (
    id            BIGSERIAL PRIMARY KEY,
    event_type    VARCHAR(100) NOT NULL,
    source        VARCHAR(50)  NOT NULL,
    payload       JSONB        NOT NULL,
    status        VARCHAR(20)  NOT NULL DEFAULT 'pending',
    priority      INTEGER      NOT NULL DEFAULT 0,
    operation_key VARCHAR(255) NOT NULL UNIQUE,
    retry_count   INTEGER      NOT NULL DEFAULT 0,
    max_retries   INTEGER      NOT NULL DEFAULT 5,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at     TIMESTAMPTZ,
    error_message TEXT,
    deal_id       BIGINT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    processed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_queue_pick ON integration_queue (status, next_attempt_at, priority DESC, id);
CREATE INDEX IF NOT EXISTS idx_queue_deal ON integration_queue (deal_id);

CREATE TABLE IF NOT EXISTS integration_logs (
    id         BIGSERIAL PRIMARY KEY,
    queue_id   BIGINT REFERENCES integration_queue(id) ON DELETE CASCADE,
    deal_id    BIGINT,
    level      VARCHAR(20) NOT NULL,
    message    TEXT        NOT NULL,
    metadata   JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_deal ON integration_logs (deal_id, id);

-- Каждый вызов внешней системы на запись. В тестовом режиме вызов не выполняется,
-- но строка остаётся: по ней видно, что хаб отправил бы.
CREATE TABLE IF NOT EXISTS outbound_calls (
    id         BIGSERIAL PRIMARY KEY,
    system     VARCHAR(20) NOT NULL,
    action     VARCHAR(60) NOT NULL,
    deal_id    BIGINT,
    mode       VARCHAR(10) NOT NULL,
    status     VARCHAR(20) NOT NULL,
    request    JSONB,
    response   JSONB,
    error      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbound_deal ON outbound_calls (deal_id, id);
