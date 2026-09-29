FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WHISPER_DOWNLOAD_ROOT=/models

WORKDIR /srv/whisper-service

# faster-whisper ships its own audio decoding (PyAV); no system ffmpeg needed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py engine.py ./

# Pre-download the model at build time so the first request is fast.
# Override with: docker build --build-arg WHISPER_MODEL=medium .
ARG WHISPER_MODEL=large-v3-turbo
ENV WHISPER_MODEL=${WHISPER_MODEL}
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', download_root='/models')"

VOLUME ["/models"]
EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
