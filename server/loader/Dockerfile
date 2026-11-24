# Imagen one-off del loader: ZIP/CSV anual del MEF → PostgreSQL (curl + psycopg).
# Build:  docker build -t qhaway-loader /opt/qhaway-api/loader
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "psycopg[binary]==3.2.3"
WORKDIR /loader
COPY load.py load_parallel.py load_json.py load_tematico.py ./
COPY migraciones/ ./migraciones/
COPY manual/ ./manual/
# Descargas temporales (ZIP ~0.7 GB; CSV fallback ~10 GB): montar un volumen con espacio aquí.
ENV QHAWAY_TMP=/work
RUN mkdir -p /work
ENTRYPOINT ["python", "load.py"]
