from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .database import create_database, get_session, initialize_database
from .ingestion import IngestionError, prepare_uploads, store_documents
from .models import Document, DocumentClassification, Project, ProjectWorkflow
from .requirements_api import router as requirements_router
from .schemas import DocumentResponse, HealthResponse, ProjectCreate, ProjectResponse
from .security import LocalRequestMiddleware
from .workflow_api import router as workflow_router


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    frontend_dist = resolved_settings.frontend_dir or (
        Path(__file__).resolve().parents[2] / "frontend" / "dist"
    )
    if resolved_settings.web_enabled and not frontend_dist.is_dir():
        raise RuntimeError(
            "Web mode requires a built frontend directory. Run the frontend build or set "
            "COMPLIANCE_FRONTEND_DIR."
        )
    engine, session_factory = create_database(resolved_settings.database_path)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        resolved_settings.documents_dir.mkdir(parents=True, exist_ok=True)
        initialize_database(engine)
        yield
        engine.dispose()

    application = FastAPI(
        title="DoD RFP Compliance API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None,
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    application.state.settings = resolved_settings
    application.state.session_factory = session_factory
    application.add_middleware(LocalRequestMiddleware, settings=resolved_settings)

    @application.get("/api/health", response_model=HealthResponse)
    def health(session: Session = Depends(get_session)) -> HealthResponse:
        session.execute(select(Project.id).limit(1)).first()
        access_mode = (
            resolved_settings.web_access_mode if resolved_settings.web_enabled else "local"
        )
        return HealthResponse(
            status="ok",
            host=resolved_settings.host,
            telemetry=False,
            access_mode=access_mode,
        )

    @application.post(
        "/api/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED
    )
    def create_project(payload: ProjectCreate, session: Session = Depends(get_session)) -> Project:
        project = Project(**payload.model_dump())
        project.workflow = ProjectWorkflow()
        session.add(project)
        session.commit()
        session.refresh(project)
        return project

    @application.get("/api/projects", response_model=list[ProjectResponse])
    def list_projects(session: Session = Depends(get_session)) -> list[Project]:
        return list(session.scalars(select(Project).order_by(Project.created_at, Project.id)))

    @application.get("/api/projects/{project_id}", response_model=ProjectResponse)
    def get_project(project_id: str, session: Session = Depends(get_session)) -> Project:
        project = session.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found.")
        return project

    @application.post(
        "/api/projects/{project_id}/documents",
        response_model=list[DocumentResponse],
        status_code=status.HTTP_201_CREATED,
    )
    async def upload_documents(
        project_id: str,
        files: list[UploadFile] = File(...),
        classification: DocumentClassification = Form(DocumentClassification.UNCLASSIFIED),
        volume_name: str | None = Form(default=None, max_length=250),
        classification_notes: str | None = Form(default=None, max_length=2_000),
        session: Session = Depends(get_session),
    ) -> list[Document]:
        if session.get(Project, project_id) is None:
            raise HTTPException(status_code=404, detail="Project not found.")
        if classification == DocumentClassification.PROPOSAL_VOLUME and not (
            volume_name and volume_name.strip()
        ):
            raise HTTPException(
                status_code=422,
                detail="volume_name is required for proposal-volume uploads.",
            )
        try:
            prepared = await prepare_uploads(files, resolved_settings)
            return store_documents(
                session=session,
                project_id=project_id,
                prepared=prepared,
                settings=resolved_settings,
                classification=classification,
                volume_name=volume_name.strip() if volume_name else None,
                classification_notes=(
                    classification_notes.strip() if classification_notes else None
                ),
            )
        except IngestionError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from None

    @application.get("/api/projects/{project_id}/documents", response_model=list[DocumentResponse])
    def list_documents(project_id: str, session: Session = Depends(get_session)) -> list[Document]:
        if session.get(Project, project_id) is None:
            raise HTTPException(status_code=404, detail="Project not found.")
        return list(
            session.scalars(
                select(Document)
                .where(Document.project_id == project_id)
                .order_by(Document.created_at, Document.id)
            )
        )

    application.include_router(requirements_router)
    application.include_router(workflow_router)

    if frontend_dist.is_dir():
        application.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

    return application


app = create_app()


def run() -> None:
    """Run in local mode by default or explicit, validated web mode."""

    settings: Settings = app.state.settings
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        reload=False,
        proxy_headers=False,
        server_header=False,
    )


if __name__ == "__main__":
    run()
