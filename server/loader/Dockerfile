# Imagen one-off para migrar los CSV del MEF a PostgreSQL (curl + psycopg).
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "psycopg[binary]==3.2.3"
WORKDIR /loader
COPY load.py .
ENTRYPOINT ["python", "load.py"]
