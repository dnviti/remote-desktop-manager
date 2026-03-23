# Demo Query Files

Test queries for all 6 supported database engines, ranging from basic SELECTs to complex analytics.

## Files

| File | Engine | Queries | Complexity |
|------|--------|---------|------------|
| `mysql-queries.sql` | MySQL 8.0 | ~40 | Basic → JSON, recursive CTEs, RFM, cohort analysis |
| `postgresql-queries.sql` | PostgreSQL 16 | ~35 | Basic → LATERAL, JSONB, pg_trgm fuzzy search, ARRAY ops |
| `mssql-queries.sql` | SQL Server 2022 | ~35 | Basic → CROSS/OUTER APPLY, PIVOT, FOR JSON, STRING_AGG |
| `oracle-queries.sql` | Oracle Free | ~35 | Basic → CONNECT BY, MATCH_RECOGNIZE, PIVOT/UNPIVOT, packages |
| `mongodb-queries.js` | MongoDB 7 | ~25 | Basic → $graphLookup, $setWindowFields, faceted search, text search |
| `db2-queries.sql` | DB2 12.1 | ~30 | Basic → GROUPING SETS, CUBE, LATERAL, XML functions |
| `cross-database-tests.sql` | All (ANSI SQL) | 10 | Portable queries to compare behavior across engines |

## Connection Details

| Database | Port | User | Password | Database |
|----------|------|------|----------|----------|
| PostgreSQL | 5432 | arsenale | *(from .env)* | demodb |
| MySQL | 3306 | root | rootpass | demodb |
| MongoDB | 27017 | root | rootpass | demodb (authSource=admin) |
| MSSQL | 1433 | sa | RootPass1! | demodb |
| Oracle | 1521 | demo | demopass | Service: FREEPDB1 |
| DB2 | 50000 | db2inst1 | rootpass | demodb |

## Query Categories

Each file covers these topics in order:

1. **Basic** — Simple SELECT, WHERE, ORDER BY
2. **Joins & Aggregation** — Multi-table JOINs, GROUP BY, HAVING
3. **CTEs & Subqueries** — WITH clauses, correlated subqueries
4. **Window Functions** — RANK, LAG, running totals, NTILE
5. **Recursive Queries** — Category trees, org charts
6. **Advanced Analytics** — RFM analysis, market basket, cohort retention
7. **Engine-Specific** — Features unique to each database
8. **Stored Programs** — Procedure/function calls
9. **Views** — Querying pre-built views
