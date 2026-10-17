"""Explicit local-development settings and fail-closed production settings."""
import os
import secrets
import re
from pathlib import Path
from urllib.parse import urlsplit

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    value = os.environ.get(name, str(default)).strip().lower()
    if value not in {"true", "false", "1", "0", "yes", "no"}:
        raise ImproperlyConfigured(f"{name} must be true or false.")
    return value in {"true", "1", "yes"}


def env_list(name, default=""):
    return [value.strip() for value in os.environ.get(name, default).split(",") if value.strip()]


DEBUG = env_bool("DEBUG")
ALLOW_DEMO_LOGIN = env_bool("ALLOW_DEMO_LOGIN")
SECRET_KEY = os.environ.get("SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("Set SECRET_KEY before running production.")
    SECRET_KEY = secrets.token_urlsafe(64)
if not DEBUG and (len(SECRET_KEY) < 50 or SECRET_KEY.startswith("development-")):
    raise ImproperlyConfigured("Production SECRET_KEY must be a new random value of at least 50 characters.")
if ALLOW_DEMO_LOGIN and not DEBUG:
    raise ImproperlyConfigured("Demo login is forbidden when DEBUG=False.")

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]" if DEBUG else "")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://127.0.0.1:8000" if DEBUG else "").rstrip("/")
OIDC_ISSUER_URL = os.environ.get("OIDC_ISSUER_URL", "").strip()
OIDC_PROVIDER = os.environ.get("OIDC_PROVIDER", "generic").strip().lower()
if OIDC_PROVIDER not in {"generic", "microsoft"}:
    raise ImproperlyConfigured("OIDC_PROVIDER must be generic or microsoft.")
OIDC_CLIENT_ID = os.environ.get("OIDC_CLIENT_ID", "").strip()
OIDC_CLIENT_SECRET = os.environ.get("OIDC_CLIENT_SECRET", "").strip()
OIDC_REDIRECT_URI = os.environ.get(
    "OIDC_REDIRECT_URI", APP_BASE_URL + "/auth/callback/" if DEBUG else ""
).strip()
OIDC_TOKEN_ENDPOINT_AUTH_METHOD = os.environ.get("OIDC_TOKEN_ENDPOINT_AUTH_METHOD", "client_secret_basic")
if OIDC_TOKEN_ENDPOINT_AUTH_METHOD not in {"client_secret_basic", "client_secret_post"}:
    raise ImproperlyConfigured("Unsupported OIDC_TOKEN_ENDPOINT_AUTH_METHOD.")
OIDC_CONFIGURED = all([OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET])
if any([OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET]) and not OIDC_CONFIGURED:
    raise ImproperlyConfigured("Provide all three OIDC issuer/client values, or leave all empty for local demo.")


def validated_url(value, name, *, origin_only=False, allow_local_http=False):
    try:
        parsed = urlsplit(value)
        parsed.port  # reject invalid ports
    except ValueError as exc:
        raise ImproperlyConfigured(f"Invalid {name}.") from exc
    local_http = allow_local_http and parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (
        (parsed.scheme != "https" and not local_http)
        or not parsed.netloc or parsed.username or parsed.password
        or parsed.query or parsed.fragment
        or (origin_only and parsed.path not in {"", "/"})
    ):
        raise ImproperlyConfigured(f"{name} must be a fixed HTTPS URL" + (" (loopback HTTP is allowed in DEBUG)." if allow_local_http else "."))
    return parsed


app_url = validated_url(APP_BASE_URL, "APP_BASE_URL", origin_only=True, allow_local_http=DEBUG)
callback = validated_url(OIDC_REDIRECT_URI, "OIDC_REDIRECT_URI", allow_local_http=DEBUG)
if OIDC_REDIRECT_URI != APP_BASE_URL + "/auth/callback/":
    raise ImproperlyConfigured("OIDC_REDIRECT_URI must equal APP_BASE_URL + /auth/callback/.")
if OIDC_ISSUER_URL:
    validated_url(OIDC_ISSUER_URL, "OIDC_ISSUER_URL")
    if OIDC_PROVIDER == "microsoft" and not re.fullmatch(
        r"https://login\.microsoftonline\.com/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/v2\.0",
        OIDC_ISSUER_URL,
    ):
        raise ImproperlyConfigured("Microsoft sign-in requires the exact public-cloud tenant UUID issuer; common/organizations/consumers are forbidden.")
if not ALLOWED_HOSTS or any("*" in host or host.startswith(".") for host in ALLOWED_HOSTS):
    raise ImproperlyConfigured("Set exact ALLOWED_HOSTS; wildcards are forbidden.")
if app_url.hostname not in ALLOWED_HOSTS and not (app_url.hostname == "::1" and "[::1]" in ALLOWED_HOSTS):
    raise ImproperlyConfigured("APP_BASE_URL host must be listed in ALLOWED_HOSTS.")
if not DEBUG:
    if not OIDC_CONFIGURED:
        raise ImproperlyConfigured("Production requires official school OIDC configuration.")
    if not CSRF_TRUSTED_ORIGINS or APP_BASE_URL not in CSRF_TRUSTED_ORIGINS:
        raise ImproperlyConfigured("CSRF_TRUSTED_ORIGINS must include APP_BASE_URL in production.")
    for origin in CSRF_TRUSTED_ORIGINS:
        validated_url(origin, "CSRF_TRUSTED_ORIGINS", origin_only=True)
        if "*" in origin:
            raise ImproperlyConfigured("Wildcard CSRF origins are forbidden.")

INSTALLED_APPS = [
    "django.contrib.auth", "django.contrib.contenttypes", "django.contrib.sessions",
    "django.contrib.messages", "django.contrib.staticfiles", "identity", "grades",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "identity.middleware.PrivacyHeadersMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [BASE_DIR / "templates"], "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request", "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"
DATABASES = {"default": dj_database_url.config(
    default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}", conn_max_age=60,
    conn_health_checks=True,
)}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTHENTICATION_BACKENDS = ["identity.backends.SchoolSessionBackend"]
AUTH_PASSWORD_VALIDATORS = []  # No password sign-in, registration, reset, or admin endpoints exist.
LOGIN_URL = "identity:login"
LOGIN_REDIRECT_URL = "grades:dashboard"
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static", ("guest", BASE_DIR / "guest-site" / "assets")]
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_AGE = 3600
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_SAMESITE = "Lax"  # Required for the provider's top-level GET callback.
CSRF_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"
SECURE_SSL_REDIRECT = not DEBUG
SECURE_HSTS_SECONDS = 31536000 if not DEBUG else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
SECURE_CONTENT_TYPE_NOSNIFF = True
# Send origin only, never paths/query strings. Unlike no-referrer, this keeps
# a real Origin on browser form POSTs so Django can enforce CSRF correctly.
SECURE_REFERRER_POLICY = "strict-origin"
X_FRAME_OPTIONS = "DENY"
if env_bool("TRUST_PROXY_HEADERS"):
    # Enable only behind a proxy that strips and replaces this header.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = False
DATA_UPLOAD_MAX_MEMORY_SIZE = 1048576
FILE_UPLOAD_MAX_MEMORY_SIZE = 1048576
DATA_UPLOAD_MAX_NUMBER_FIELDS = 200

# Request URLs include OIDC authorization codes. Never log URLs, bodies, token
# objects, claims, database queries, or exception locals. Add only deliberately
# redacted operational events if your deployment needs application logging.
LOGGING = {
    "version": 1, "disable_existing_loggers": False,
    "handlers": {"null": {"class": "logging.NullHandler"}},
    "root": {"handlers": ["null"], "level": "WARNING"},
    "loggers": {name: {"handlers": ["null"], "propagate": False} for name in (
        "django", "django.request", "django.server", "django.db.backends", "authlib", "urllib3", "requests"
    )},
}
