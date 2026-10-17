FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY . .
# Collect only public static assets. Temporary build settings do not persist.
RUN DEBUG=True ALLOW_DEMO_LOGIN=False SECRET_KEY=build-only-static-collection \
    APP_BASE_URL=http://127.0.0.1:8000 \
    OIDC_REDIRECT_URI=http://127.0.0.1:8000/auth/callback/ \
    python manage.py collectstatic --noinput \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home app \
    && mkdir -p /app/data \
    && chown -R app:app /app/data

USER 10001:10001
EXPOSE 8000
# Access logs are disabled by default: callback URLs can contain OAuth codes.
# Run migrations explicitly as a release operation, not on every web startup.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "30", "--error-logfile", "-"]
