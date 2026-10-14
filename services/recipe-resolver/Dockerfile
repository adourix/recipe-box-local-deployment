FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8081
WORKDIR /srv
RUN pip install --no-cache-dir "yt-dlp==2026.7.4"
COPY server.py /srv/server.py
EXPOSE 8081
USER 10001:10001
CMD ["python", "/srv/server.py"]
