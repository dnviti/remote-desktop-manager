import pg from 'pg';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import mssql from 'mssql';
import type OracleDb from 'oracledb';
import type { DbProtocol, DbSessionConfig } from '../../types';

export type DriverPool =
  | { type: 'postgresql'; pool: pg.Pool }
  | { type: 'mysql'; pool: mysql.Pool }
  | { type: 'mongodb'; client: MongoClient; dbName: string }
  | { type: 'mssql'; pool: mssql.ConnectionPool }
  | { type: 'oracle'; pool: OracleDb.Pool }
  | { type: 'db2'; conn: unknown; dbName: string };

export interface ManagedPool {
  sessionId: string;
  protocol: DbProtocol;
  driver: DriverPool;
  databaseName?: string;
  sessionConfig?: DbSessionConfig;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface ExplainResult {
  supported: boolean;
  plan?: unknown;
  format?: 'json' | 'xml' | 'text';
  raw?: string;
}

export interface IntrospectionResult {
  supported: boolean;
  data?: unknown;
}

export type IntrospectionType =
  | 'indexes'
  | 'statistics'
  | 'foreign_keys'
  | 'table_schema'
  | 'row_count'
  | 'database_version';
