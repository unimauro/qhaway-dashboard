FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .

EXPOSE 8000
# 1 worker: el rate-limiting y el throttle del buzón usan estado en memoria; con varios
# workers cada proceso tendría su propio contador y el límite no sería fiable. La carga
# del observatorio (endpoints cacheados + SMTP en threadpool) se atiende de sobra con uno.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
