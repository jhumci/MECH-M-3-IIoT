FROM python:3.12.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir paho-mqtt==2.1.0 \
    && mkdir /data /backups && chown 10001:10001 /data /backups
WORKDIR /app
COPY collector.py .
USER 10001:10001
CMD ["python", "collector.py"]
