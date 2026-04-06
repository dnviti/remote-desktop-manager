import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DbSchemaInfo } from '../../api/database.api';
import DbSchemaBrowser from './DbSchemaBrowser';

function sampleMongoSchema(): DbSchemaInfo {
  return {
    tables: [
      {
        name: 'demo_customers',
        schema: 'arsenale_demo',
        columns: [
          { name: '_id', dataType: 'objectId', nullable: false, isPrimaryKey: true },
          { name: 'name', dataType: 'string', nullable: false, isPrimaryKey: false },
          { name: 'active', dataType: 'bool', nullable: true, isPrimaryKey: false },
        ],
      },
    ],
  };
}

function sampleMssqlSchema(): DbSchemaInfo {
  return {
    tables: [
      {
        name: 'demo_customers',
        schema: 'dbo',
        columns: [
          { name: 'id', dataType: 'int', nullable: false, isPrimaryKey: true },
          { name: 'name', dataType: 'nvarchar', nullable: false, isPrimaryKey: false },
        ],
      },
    ],
  };
}

describe('DbSchemaBrowser', () => {
  it('renders MongoDB-specific collection labels and actions', async () => {
    const onInsertSql = vi.fn();

    const view = render(
      <DbSchemaBrowser
        schema={sampleMongoSchema()}
        open
        onClose={() => {}}
        onRefresh={() => {}}
        onInsertSql={onInsertSql}
        dbProtocol="mongodb"
      />,
    );

    expect(view.getByText('Collections (1)')).toBeInTheDocument();
    expect(view.getByText('Database: arsenale_demo')).toBeInTheDocument();
    expect(view.queryByText('Tables (1)')).not.toBeInTheDocument();

    const collectionButton = view.getByText('demo_customers').closest('[role="button"]');
    expect(collectionButton).not.toBeNull();

    collectionButton!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    (await view.findByText('Find documents')).click();

    expect(onInsertSql).toHaveBeenCalledWith(expect.stringContaining('"operation": "find"'));
    expect(onInsertSql).toHaveBeenCalledWith(expect.stringContaining('"collection": "demo_customers"'));
    expect(onInsertSql).toHaveBeenCalledWith(expect.stringContaining('"database": "arsenale_demo"'));
  });

  it('emits valid MSSQL select syntax from the table context menu', async () => {
    const onInsertSql = vi.fn();

    const view = render(
      <DbSchemaBrowser
        schema={sampleMssqlSchema()}
        open
        onClose={() => {}}
        onRefresh={() => {}}
        onInsertSql={onInsertSql}
        dbProtocol="mssql"
      />,
    );

    const tableButton = view.getByText('demo_customers').closest('[role="button"]');
    expect(tableButton).not.toBeNull();

    tableButton!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    (await view.findByText('SELECT *')).click();

    expect(onInsertSql).toHaveBeenCalledWith('SELECT TOP 100 *\nFROM demo_customers;');
  });
});
