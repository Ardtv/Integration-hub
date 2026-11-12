// Вся конфигурация хаба читается из окружения в одном месте.
// Никаких ID этапов, полей, складов и ключей в коде быть не должно.

export type HubMode = 'test' | 'live';

function num(v: string | undefined): number | null {
    if (v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function list(v: string | undefined): string[] {
    return (v || '').split(',').map(s => s.trim()).filter(Boolean);
}
function json(name: string, v: string | undefined): Record<string, any> {
    if (!v) return {};
    try {
        const parsed = JSON.parse(v);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* ниже */ }
    throw new Error(`${name} должен быть JSON-объектом`);
}
function flag(v: string | undefined): boolean {
    return ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase());
}

export interface HubConfig {
    mode: HubMode;
    production: boolean;
    port: number;
    apiToken: string | null;
    amo: {
        domain: string | null;
        token: string | null;
        pipelineIds: number[];
        stages: { send: number | null; created: number | null; delivered: number | null; error: number | null; returned: number | null };
        fields: { method: number | null; country: number | null; deliveryType: number | null; city: number | null; address: number | null; pvz: number | null; track: number | null };
        strictSum: boolean;
    };
    cdek: {
        tariffDoor: number | null;
        tariffPvz: number | null;
        shipmentPoint: string | null;
        fromLocation: Record<string, any>;
        defaultWeightG: number;
        box: { length: number; width: number; height: number };
        extra: Record<string, any>;
        extraByCountry: { KZ: Record<string, any>; RU: Record<string, any> };
        shippedCodes: string[];
        deliveredCodes: string[];
        returnedCodes: string[];
    };
    iiko: {
        writeoffEnabled: boolean;
        organizationId: string | null;
        storeId: string | null;
        expenseAccountId: string | null;
        defaultUnitId: string | null;
    };
    onec: {
        enabled: boolean;
        saleDocument: string;
        returnDocument: string;
        itemsTable: string;
        counterpartyCatalog: string;
        counterparty: { KZ: string; RU: string };
        counterpartyRef: { KZ: string | null; RU: string | null };
        extra: Record<string, any>;
    };
    alerts: { tgToken: string | null; tgChatId: string | null };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
    const production = env.NODE_ENV === 'production';
    const wantLive = String(env.HUB_MODE || 'test').toLowerCase() === 'live';
    // Боевой режим включается только двумя переменными сразу: защита от случайного включения.
    const mode: HubMode = wantLive && String(env.HUB_LIVE_CONFIRM || '').toLowerCase() === 'yes' ? 'live' : 'test';

    return {
        mode,
        production,
        port: num(env.HUB_PORT) || 3001,
        apiToken: env.HUB_API_TOKEN || null,
        amo: {
            domain: env.AMO_API_DOMAIN || null,
            token: env.AMO_API_TOKEN || null,
            pipelineIds: list(env.AMO_PIPELINE_IDS).map(Number).filter(Number.isFinite),
            stages: {
                send: num(env.AMO_STAGE_SEND),
                created: num(env.AMO_STAGE_CREATED),
                delivered: num(env.AMO_STAGE_DELIVERED),
                error: num(env.AMO_STAGE_ERROR),
                returned: num(env.AMO_STAGE_RETURN)
            },
            fields: {
                method: num(env.AMO_FIELD_METHOD),
                country: num(env.AMO_FIELD_COUNTRY),
                deliveryType: num(env.AMO_FIELD_DELIVERY_TYPE),
                city: num(env.AMO_FIELD_CITY),
                address: num(env.AMO_FIELD_ADDRESS),
                pvz: num(env.AMO_FIELD_PVZ),
                track: num(env.AMO_FIELD_TRACK)
            },
            strictSum: env.AMO_STRICT_SUM === undefined ? true : flag(env.AMO_STRICT_SUM)
        },
        cdek: {
            tariffDoor: num(env.CDEK_TARIFF_DOOR),
            tariffPvz: num(env.CDEK_TARIFF_PVZ),
            shipmentPoint: env.CDEK_SHIPMENT_POINT || null,
            fromLocation: json('CDEK_FROM_LOCATION_JSON', env.CDEK_FROM_LOCATION_JSON),
            defaultWeightG: num(env.CDEK_DEFAULT_ITEM_WEIGHT_G) || 200,
            box: {
                length: num(env.CDEK_BOX_LENGTH_CM) || 20,
                width: num(env.CDEK_BOX_WIDTH_CM) || 15,
                height: num(env.CDEK_BOX_HEIGHT_CM) || 10
            },
            extra: json('CDEK_ORDER_EXTRA_JSON', env.CDEK_ORDER_EXTRA_JSON),
            extraByCountry: {
                KZ: json('CDEK_ORDER_EXTRA_KZ_JSON', env.CDEK_ORDER_EXTRA_KZ_JSON),
                RU: json('CDEK_ORDER_EXTRA_RU_JSON', env.CDEK_ORDER_EXTRA_RU_JSON)
            },
            shippedCodes: list(env.CDEK_SHIPPED_CODES || 'RECEIVED_AT_SHIPMENT_WAREHOUSE,READY_FOR_SHIPMENT_IN_SENDER_CITY,TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY'),
            deliveredCodes: list(env.CDEK_DELIVERED_CODES || 'DELIVERED'),
            returnedCodes: list(env.CDEK_RETURNED_CODES || 'NOT_DELIVERED')
        },
        iiko: {
            writeoffEnabled: flag(env.IIKO_WRITEOFF_ENABLED),
            organizationId: env.IIKO_ORGANIZATION_ID || null,
            storeId: env.IIKO_STORE_ID || null,
            expenseAccountId: env.IIKO_EXPENSE_ACCOUNT_ID || null,
            defaultUnitId: env.IIKO_DEFAULT_UNIT_ID || null
        },
        onec: {
            enabled: flag(env.API_1C_ENABLED),
            saleDocument: env.API_1C_SALE_DOCUMENT || 'Document_РеализацияТоваровУслуг',
            returnDocument: env.API_1C_RETURN_DOCUMENT || 'Document_ВозвратТоваровОтКлиента',
            itemsTable: env.API_1C_ITEMS_TABLE || 'Товары',
            counterpartyCatalog: env.API_1C_COUNTERPARTY_CATALOG || 'Catalog_Контрагенты',
            counterparty: { KZ: env.API_1C_COUNTERPARTY_KZ || 'Розница', RU: env.API_1C_COUNTERPARTY_RU || 'Розница РФ' },
            counterpartyRef: { KZ: env.API_1C_COUNTERPARTY_KZ_REF || null, RU: env.API_1C_COUNTERPARTY_RU_REF || null },
            extra: json('API_1C_DOCUMENT_EXTRA_JSON', env.API_1C_DOCUMENT_EXTRA_JSON)
        },
        alerts: { tgToken: env.ALERT_TG_BOT_TOKEN || null, tgChatId: env.ALERT_TG_CHAT_ID || null }
    };
}

/** Что мешает запуску. В production список непустой → процесс не стартует. */
export function startupProblems(cfg: HubConfig): string[] {
    const p: string[] = [];
    if (!cfg.apiToken) p.push('HUB_API_TOKEN не задан: API хаба остался бы без защиты');
    if (cfg.mode === 'live') {
        if (!cfg.amo.domain || !cfg.amo.token) p.push('AMO_API_DOMAIN и AMO_API_TOKEN обязательны в боевом режиме');
        if (!cfg.amo.stages.send) p.push('AMO_STAGE_SEND не задан: неизвестно, какой этап запускает отправку');
        if (!cfg.amo.fields.method) p.push('AMO_FIELD_METHOD не задан');
        if (!cfg.cdek.tariffDoor || !cfg.cdek.tariffPvz) p.push('CDEK_TARIFF_DOOR и CDEK_TARIFF_PVZ обязательны в боевом режиме');
        if (!cfg.cdek.shipmentPoint && Object.keys(cfg.cdek.fromLocation).length === 0) {
            p.push('Нужен CDEK_SHIPMENT_POINT или CDEK_FROM_LOCATION_JSON: откуда отправляется заказ');
        }
    }
    return p;
}
