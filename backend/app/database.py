from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import Request
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session, sessionmaker

from .models import Base


def create_database(database_path: Path) -> tuple[Engine, sessionmaker[Session]]:
    try:
        database_path.parent.mkdir(parents=True, exist_ok=True)
        if not database_path.parent.is_dir():
            raise OSError("configured data path is not a directory")
        with NamedTemporaryFile(prefix=".write-test-", dir=database_path.parent):
            pass
    except OSError as exc:
        raise RuntimeError(f"COMPLIANCE_DATA_DIR is not writable: {database_path.parent}") from exc
    url = URL.create("sqlite+pysqlite", database=str(database_path))
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 5})

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection: object, _connection_record: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    return engine, sessionmaker(bind=engine, expire_on_commit=False)


def initialize_database(engine: Engine) -> None:
    Base.metadata.create_all(engine)


def get_session(request: Request) -> Iterator[Session]:
    session_factory: sessionmaker[Session] = request.app.state.session_factory
    with session_factory() as session:
        yield session
