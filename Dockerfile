# CQA: FastAPI-сервер + интерфейс. База SQLite — на постоянном диске (volume) в /data.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 CQA_DB_PATH=/data/cqa.sqlite3
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt
COPY backend backend
COPY frontend frontend
COPY data/checklists data/checklists
COPY data/assistant_kb.json data/assistant_kb.json
COPY data/fixtures data/fixtures
COPY evaluation/reports evaluation/reports
RUN mkdir -p /data
WORKDIR /app/backend
EXPOSE 8000
CMD ["sh", "-c", "uvicorn cqa.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
