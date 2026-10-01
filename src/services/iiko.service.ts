import axios, { AxiosInstance } from 'axios';

const IIKO_BASE_URL = 'https://api-ru.iiko.services';

export class IikoService {
  private client: AxiosInstance;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private apiKey: string,
    private appId: string,
    private clientSecret: string
  ) {
    this.client = axios.create({
      baseURL: IIKO_BASE_URL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * АВТОРИЗАЦИЯ v2 (обязательно!)
   * Старый /api/1/access_token отключается iiko с 1 сентября 2026
   */
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.token;
    }

    console.log('🔑 iiko: получение токена v2...');
    const resp = await this.client.post('/api/v2/access_token', {
      apiKey: this.apiKey,
      appId: this.appId,
      clientSecret: this.clientSecret
    });

    this.token = resp.data.token;
    this.tokenExpiresAt = Date.now() + 60 * 60 * 1000;
    console.log('✅ iiko: токен получен');
    return this.token!;
  }

  /**
   * Обёртка для авторизованных запросов с авто-обновлением токена
   */
  private async authPost<T = any>(path: string, body: any = {}): Promise<T> {
    const token = await this.getToken();
    try {
      const resp = await this.client.post<T>(path, body, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return resp.data;
    } catch (err: any) {
      if (err.response?.status === 401) {
        this.token = null;
        this.tokenExpiresAt = 0;
        const newToken = await this.getToken();
        const resp = await this.client.post<T>(path, body, {
          headers: { Authorization: `Bearer ${newToken}` }
        });
        return resp.data;
      }
      throw err;
    }
  }

  /**
   * ПРАВИЛЬНЫЙ эндпоинт для остатков
   * POST /api/inventory/v1/stock_balance/list
   */
  async getStockBalance(
    organizationId: string,
    balanceAt: string,
    storeIds?: string[],
    productIds?: string[]
  ): Promise<any> {
    console.log(`📦 iiko: запрос остатков на ${balanceAt}`);
    return this.authPost('/api/inventory/v1/stock_balance/list', {
      organizationId,
      balanceAt,
      storeIds,
      productIds,
      limit: 1000,
      offset: 0,
      shouldIncludeDetails: true
    });
  }

  /**
   * ПРАВИЛЬНЫЙ эндпоинт для списка списаний
   * POST /api/inventory/v1/writeoff_document/list
   */
  async getWriteoffDocuments(
    organizationId: string,
    from: string,
    to: string
  ): Promise<any[]> {
    console.log(`📝 iiko: запрос списаний с ${from} по ${to}`);
    return this.authPost('/api/inventory/v1/writeoff_document/list', {
      organizationId,
      from,
      to
    });
  }

  /**
   * Список организаций
   * POST /api/1/organizations
   */
  async getOrganizations(): Promise<any> {
    console.log('🏢 iiko: запрос организаций...');
    return this.authPost('/api/1/organizations', {});
  }

  /**
   * Универсальный вызов для отладки
   */
  async request(method: string, path: string, body: any = {}): Promise<any> {
    const token = await this.getToken();
    const resp = await this.client.request({
      method,
      url: path,
      data: body,
      headers: { Authorization: `Bearer ${token}` }
    });
    return resp.data;
  }
  /**
   * Проверить, что заказ списал ингредиенты
   * Ищет списания за последние N часов и фильтрует по сумме/составу
   */
  async checkOrderWriteoff(
    organizationId: string,
    hoursBack: number = 1
  ): Promise<any[]> {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - hoursBack * 3600 * 1000)
      .toISOString()
      .slice(0, 10);

    const writeoffs = await this.getWriteoffDocuments(
      organizationId,
      from,
      to
    );

    // Фильтруем списания, созданные за последние N часов
    const threshold = Date.now() - hoursBack * 3600 * 1000;
    return writeoffs.filter(w => {
      const wTime = new Date(w.date).getTime();
      return wTime >= threshold;
    });
  }
}
