---
name: Database Query
description: Execute read-only SQL queries against SQLite, PostgreSQL, or MySQL databases and return results as JSON.
script: scripts/main.py
language: python
install: uv sync
timeout: 30
---
# Database Query

Execute read-only SQL queries against SQLite, PostgreSQL, or MySQL databases. Returns results as JSON.

## Input

- `query` (str, required): SQL query to execute (SELECT, SHOW, DESCRIBE, EXPLAIN, PRAGMA only)
- `database` (str, required): For SQLite: file path. For PG/MySQL: connection string or object.
- `db_type` (str, optional, default "sqlite"): "sqlite", "postgresql", or "mysql"
- `params` (array, optional): Query parameters for parameterized queries
- For postgresql/mysql connection object alternative:
  - `host` (str), `port` (int), `user` (str), `password` (str), `dbname` (str)

## Output

- `columns` (array of str): Column names
- `rows` (array of arrays): Row data
- `row_count` (int): Number of rows returned
- `column_count` (int): Number of columns

## Secrets

- `$DB_HOST` — Database host
- `$DB_PORT` — Database port
- `$DB_USER` — Database user
- `$DB_PASS` — Database password
- `$DB_NAME` — Database name
