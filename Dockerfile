# syntax=docker/dockerfile:1.7

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend
FROM python:3.11-slim
WORKDIR /app

# System libs for build/runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libzbar0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first to maximize layer cache reuse
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY *.py ./

# Copy frontend build from stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Environment variables
ENV CONFIG_DIR=/config
ENV DOWNLOAD_DIR=/downloads
ENV PYTHONUNBUFFERED=1

# Volumes
VOLUME ["/config", "/downloads"]

# Expose port
EXPOSE 8001

# Command
CMD ["python", "api.py"]
