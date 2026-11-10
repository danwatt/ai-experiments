FROM python:3.12-slim

# pyosmium's wheel links against libexpat, which the slim image lacks.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libexpat1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv

# The venv lives outside /app because /app is replaced by a bind mount.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml ./
RUN uv sync --no-install-project

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
