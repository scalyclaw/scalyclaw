import sys
import json
import os
import re
import sqlite3


MAX_ROWS = 10000

FORBIDDEN_PATTERNS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b",
    re.IGNORECASE,
)

ALLOWED_PATTERNS = re.compile(
    r"^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|PRAGMA)\b",
    re.IGNORECASE,
)


def validate_query(query):
    stripped = query.strip().rstrip(";").strip()

    if not ALLOWED_PATTERNS.match(stripped):
        raise ValueError(
            "Only SELECT, SHOW, DESCRIBE, EXPLAIN, and PRAGMA queries are allowed"
        )

    cleaned = re.sub(r"'[^']*'", "''", stripped)
    cleaned = re.sub(r'"[^"]*"', '""', cleaned)
    cleaned = re.sub(r"--[^\n]*", "", cleaned)
    cleaned = re.sub(r"/\*.*?\*/", "", cleaned, flags=re.DOTALL)

    if FORBIDDEN_PATTERNS.search(cleaned):
        raise ValueError(
            "Write operations are not allowed (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE)"
        )


def query_sqlite(database, query, params):
    if not os.path.isfile(database):
        raise FileNotFoundError(f"SQLite database not found: {database}")

    uri = f"file:{database}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        cursor = conn.cursor()
        if params:
            cursor.execute(query, params)
        else:
            cursor.execute(query)

        rows = cursor.fetchmany(MAX_ROWS)
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        return columns, [list(row) for row in rows]
    finally:
        conn.close()


def query_postgresql(data, query, params):
    import psycopg2

    conn_params = _resolve_pg_connection(data)
    print(f"[pg] connecting to {conn_params.get('host', 'localhost')}:{conn_params.get('port', 5432)}", file=sys.stderr)

    conn = psycopg2.connect(**conn_params)
    try:
        conn.set_session(readonly=True, autocommit=True)
        cursor = conn.cursor()
        if params:
            cursor.execute(query, params)
        else:
            cursor.execute(query)

        rows = cursor.fetchmany(MAX_ROWS)
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        return columns, [_serialize_row(row) for row in rows]
    finally:
        conn.close()


def query_mysql(data, query, params):
    import pymysql

    conn_params = _resolve_mysql_connection(data)
    print(f"[mysql] connecting to {conn_params.get('host', 'localhost')}:{conn_params.get('port', 3306)}", file=sys.stderr)

    conn = pymysql.connect(**conn_params)
    try:
        with conn.cursor() as cursor:
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)

            rows = cursor.fetchmany(MAX_ROWS)
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            return columns, [_serialize_row(row) for row in rows]
    finally:
        conn.close()


def _resolve_pg_connection(data):
    database = data.get("database")

    if isinstance(database, dict):
        return {
            "host": database.get("host", os.environ.get("DB_HOST", "localhost")),
            "port": int(database.get("port", os.environ.get("DB_PORT", 5432))),
            "user": database.get("user", os.environ.get("DB_USER", "postgres")),
            "password": database.get("password", os.environ.get("DB_PASS", "")),
            "dbname": database.get("dbname", os.environ.get("DB_NAME", "postgres")),
        }

    if isinstance(database, str) and database.startswith(("postgres://", "postgresql://")):
        return {"dsn": database}

    return {
        "host": data.get("host", os.environ.get("DB_HOST", "localhost")),
        "port": int(data.get("port", os.environ.get("DB_PORT", 5432))),
        "user": data.get("user", os.environ.get("DB_USER", "postgres")),
        "password": data.get("password", os.environ.get("DB_PASS", "")),
        "dbname": data.get("dbname", os.environ.get("DB_NAME", database if isinstance(database, str) else "postgres")),
    }


def _resolve_mysql_connection(data):
    database = data.get("database")

    if isinstance(database, dict):
        return {
            "host": database.get("host", os.environ.get("DB_HOST", "localhost")),
            "port": int(database.get("port", os.environ.get("DB_PORT", 3306))),
            "user": database.get("user", os.environ.get("DB_USER", "root")),
            "password": database.get("password", os.environ.get("DB_PASS", "")),
            "database": database.get("dbname", os.environ.get("DB_NAME", "")),
        }

    if isinstance(database, str) and database.startswith("mysql://"):
        from urllib.parse import urlparse

        parsed = urlparse(database)
        return {
            "host": parsed.hostname or os.environ.get("DB_HOST", "localhost"),
            "port": parsed.port or int(os.environ.get("DB_PORT", 3306)),
            "user": parsed.username or os.environ.get("DB_USER", "root"),
            "password": parsed.password or os.environ.get("DB_PASS", ""),
            "database": parsed.path.lstrip("/") or os.environ.get("DB_NAME", ""),
        }

    return {
        "host": data.get("host", os.environ.get("DB_HOST", "localhost")),
        "port": int(data.get("port", os.environ.get("DB_PORT", 3306))),
        "user": data.get("user", os.environ.get("DB_USER", "root")),
        "password": data.get("password", os.environ.get("DB_PASS", "")),
        "database": data.get("dbname", os.environ.get("DB_NAME", database if isinstance(database, str) else "")),
    }


def _serialize_row(row):
    """Convert row values to JSON-safe types."""
    result = []
    for val in row:
        if isinstance(val, (bytes, bytearray)):
            result.append(val.hex())
        elif isinstance(val, set):
            result.append(list(val))
        elif hasattr(val, "isoformat"):
            result.append(val.isoformat())
        else:
            result.append(val)
    return result


def main():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(1)

    query = data.get("query")
    if not query or not isinstance(query, str):
        print(json.dumps({"error": "'query' is required and must be a string"}))
        sys.exit(1)

    database = data.get("database")
    if not database:
        print(json.dumps({"error": "'database' is required"}))
        sys.exit(1)

    db_type = data.get("db_type", "sqlite").lower()
    params = data.get("params")

    try:
        validate_query(query)
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    try:
        if db_type == "sqlite":
            columns, rows = query_sqlite(database, query, params)
        elif db_type in ("postgresql", "postgres", "pg"):
            columns, rows = query_postgresql(data, query, params)
        elif db_type in ("mysql", "mariadb"):
            columns, rows = query_mysql(data, query, params)
        else:
            print(json.dumps({"error": f"Unsupported db_type '{db_type}'. Use: sqlite, postgresql, mysql"}))
            sys.exit(1)

        result = {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "column_count": len(columns),
        }

        print(json.dumps(result, default=str))

    except FileNotFoundError as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    except ImportError as e:
        print(json.dumps({"error": f"Missing dependency: {e}. Run 'uv sync' to install."}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Query execution failed: {e}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
