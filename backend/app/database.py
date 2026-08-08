from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import Request
from sqlalchemy import Engine, create_engine, event, literal, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session, sessionmaker

from .models import (
    Base,
    Document,
    DocumentClassification,
    DocumentProfile,
    Project,
    ProjectWorkflow,
    WorkflowStage,
    WorkflowStatus,
    utc_now,
)


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
    """Create missing tables without rewriting existing SQLite data.

    Workflow features use additive tables linked to the unchanged core project and
    document tables. SQLAlchemy's create-all operation plus conflict-safe default
    rows is therefore the idempotent migration path for databases created by earlier
    releases.
    """

    Base.metadata.create_all(engine)
    now = utc_now()
    workflow_defaults = select(
        Project.id,
        literal(WorkflowStage.PROJECT_SETUP.value),
        literal(WorkflowStatus.IN_PROGRESS.value),
        literal(now),
    )
    document_defaults = select(
        Document.id,
        Document.project_id,
        literal(DocumentClassification.UNCLASSIFIED.value),
        literal(now),
    )
    with engine.begin() as connection:
        connection.execute(
            sqlite_insert(ProjectWorkflow)
            .prefix_with("OR IGNORE")
            .from_select(
                ["project_id", "stage", "status", "updated_at"],
                workflow_defaults,
            )
        )
        connection.execute(
            sqlite_insert(DocumentProfile)
            .prefix_with("OR IGNORE")
            .from_select(
                ["document_id", "project_id", "classification", "updated_at"],
                document_defaults,
            )
        )


def get_session(request: Request) -> Iterator[Session]:
    session_factory: sessionmaker[Session] = request.app.state.session_factory
    with session_factory() as session:
        yield session
