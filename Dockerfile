FROM node:22-alpine AS frontend-build

WORKDIR /build/frontend
RUN corepack enable && corepack prepare pnpm@10.26.0 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/home/compliance \
    COMPLIANCE_MODE=web \
    COMPLIANCE_HOST=0.0.0.0 \
    COMPLIANCE_DATA_DIR=/var/data \
    COMPLIANCE_FRONTEND_DIR=/app/frontend/dist

WORKDIR /app

RUN groupadd --gid 10001 compliance \
    && useradd --uid 10001 --gid 10001 --create-home \
        --home-dir /home/compliance --shell /bin/bash compliance
COPY pyproject.toml ./
COPY backend/ ./backend/
RUN python -m pip install --no-cache-dir .
COPY --from=frontend-build /build/frontend/dist/ ./frontend/dist/
RUN install -d -m 0700 -o 10001 -g 10001 /home/compliance/.ssh \
    && install -d -m 0750 -o 10001 -g 10001 /var/data

USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.getenv('COMPLIANCE_PORT', os.getenv('PORT', '8000')) + '/api/health', timeout=3)"

CMD ["compliance-api"]
