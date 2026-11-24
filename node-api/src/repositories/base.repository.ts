import { query } from '../config/database';
import { QueryResult, QueryResultRow } from 'pg';

export abstract class BaseRepository<T extends QueryResultRow> {
  protected abstract readonly tableName: string;

  protected async executeQuery<R extends QueryResultRow = T>(
    sql: string,
    params?: any[]
  ): Promise<QueryResult<R>> {
    return query<R>(sql, params);
  }

  protected async findOne<R extends QueryResultRow = T>(
    sql: string,
    params?: any[]
  ): Promise<R | null> {
    const result = await this.executeQuery<R>(sql, params);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  protected async findMany<R extends QueryResultRow = T>(
    sql: string,
    params?: any[]
  ): Promise<R[]> {
    const result = await this.executeQuery<R>(sql, params);
    return result.rows;
  }
}
