// Type declarations for database drivers without bundled types

declare module 'oracledb' {
  export const OUT_FORMAT_OBJECT: number;
  export function createPool(config: {
    user: string;
    password: string;
    connectString: string;
    poolMin?: number;
    poolMax?: number;
    poolTimeout?: number;
  }): Promise<Pool>;
  export function initOracleClient(opts?: Record<string, unknown>): void;

  export interface Pool {
    getConnection(): Promise<Connection>;
    close(drainTime?: number): Promise<void>;
  }

  export interface Connection {
    callTimeout: number;
    execute<T = Record<string, unknown>>(
      sql: string,
      binds?: Record<string, unknown> | unknown[],
      options?: ExecuteOptions,
    ): Promise<ExecuteResult<T>>;
    close(): Promise<void>;
  }

  export interface ExecuteOptions {
    outFormat?: number;
    maxRows?: number;
  }

  export interface ExecuteResult<T = Record<string, unknown>> {
    metaData?: { name: string }[];
    rows?: T[];
    rowsAffected?: number;
  }
}

declare module 'ibm_db' {
  export function openSync(connStr: string): Database;
  export interface Database {
    querySync(sql: string): Record<string, unknown>[];
    closeSync(): void;
  }
}
