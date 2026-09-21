import { Pool } from 'pg';

export class MappingRepository {
    constructor(private pool: Pool) {}

    async save(data: {
        internalTable: string;
        internalId: number;
        externalSystem: string;
        externalId: string;
    }): Promise<void> {
        await this.pool.query(
            `INSERT INTO external_id_mapping 
             (internal_table, internal_id, external_system, external_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (internal_table, internal_id, external_system) 
             DO UPDATE SET external_id = $4, updated_at = CURRENT_TIMESTAMP`,
            [data.internalTable, data.internalId, data.externalSystem, data.externalId]
        );
    }

    async findInternalId(
        externalSystem: string,
        externalId: string,
        internalTable: string
    ): Promise<number | null> {
        const result = await this.pool.query<{ internal_id: number }>(
            `SELECT internal_id FROM external_id_mapping
             WHERE external_system = $1 AND external_id = $2 AND internal_table = $3`,
            [externalSystem, externalId, internalTable]
        );
        return result.rows[0]?.internal_id || null;
    }
}
