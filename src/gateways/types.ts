// Интерфейсы внешних систем. Оркестратор знает только их, поэтому в тестах
// системы подменяются, а в тестовом режиме записи не выполняются.

export interface AmoDealItem { amo_product_id: number; name: string | null; sku: string | null; quantity: number; price_minor: number }

export interface AmoDeal {
    id: number;
    name: string | null;
    price_minor: number;
    status_id: number | null;
    pipeline_id: number | null;
    responsible_user_id: number | null;
    updated_at: number | null;
    /** field_id → первое значение поля как строка */
    fields: Record<string, string>;
    contact: { name: string | null; phone: string | null; email: string | null };
    items: AmoDealItem[];
}

export interface AmoGateway {
    getDeal(dealId: number): Promise<AmoDeal | null>;
    setField(dealId: number, fieldId: number, value: string): Promise<void>;
    setStage(dealId: number, statusId: number, pipelineId?: number | null): Promise<void>;
    addNote(dealId: number, text: string): Promise<void>;
    addTask(dealId: number, text: string, responsibleUserId?: number | null): Promise<void>;
}

export interface CdekOrderInfo { uuid: string; cdek_number: string | null; statuses: { code: string; date_time?: string }[] }

export interface CdekGateway {
    createOrder(dealId: number, body: Record<string, any>): Promise<{ uuid: string }>;
    updateOrder(dealId: number, body: Record<string, any>): Promise<void>;
    findByImNumber(imNumber: string): Promise<CdekOrderInfo | null>;
    getOrder(uuid: string): Promise<CdekOrderInfo | null>;
}

export interface IikoGateway {
    createWriteoff(dealId: number, body: Record<string, any>): Promise<{ id: string | null }>;
}

export interface OnecGateway {
    findCounterpartyRef(catalog: string, name: string): Promise<string | null>;
    createDocument(dealId: number, documentName: string, body: Record<string, any>): Promise<{ ref: string | null; number: string | null }>;
}

export interface Gateways { amo: AmoGateway; cdek: CdekGateway; iiko: IikoGateway; onec: OnecGateway }

export interface Alerter { send(text: string): Promise<void> }
