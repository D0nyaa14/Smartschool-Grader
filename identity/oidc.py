"""One explicitly configured school issuer. No email-based account linking."""
import hashlib
from urllib.parse import urlsplit

from authlib.integrations.django_client import OAuth
from django.conf import settings


def subject_username(issuer, subject):
    """Stable internal owner key for approved (issuer, sub), never email/name."""
    if not isinstance(subject, str) or not subject or len(subject) > 255:
        raise ValueError("Invalid OIDC subject.")
    return "oidc_" + hashlib.sha256((issuer + "\0" + subject).encode("utf-8")).hexdigest()


def get_oidc_client():
    oauth = OAuth()
    return oauth.register(
        name="school",
        client_id=settings.OIDC_CLIENT_ID,
        client_secret=settings.OIDC_CLIENT_SECRET,
        server_metadata_url=settings.OIDC_ISSUER_URL.rstrip("/") + "/.well-known/openid-configuration",
        client_kwargs={
            "scope": "openid profile", "code_challenge_method": "S256",
            "token_endpoint_auth_method": settings.OIDC_TOKEN_ENDPOINT_AUTH_METHOD,
            "default_timeout": 10,
        },
    )


def validate_metadata(client):
    metadata = client.load_server_metadata()
    if metadata.get("issuer") != settings.OIDC_ISSUER_URL:
        raise ValueError("Discovery issuer does not match configured school issuer.")
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        parsed = urlsplit(metadata.get(key, ""))
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            raise ValueError("OIDC endpoints must use HTTPS.")
    # This starter intentionally accepts only asymmetric ID-token signatures.
    allowed = {"RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"}
    algorithms = [alg for alg in metadata.get("id_token_signing_alg_values_supported", []) if alg in allowed]
    if not algorithms:
        raise ValueError("Provider must support asymmetric ID-token signatures.")
    client.server_metadata["id_token_signing_alg_values_supported"] = algorithms
    if "code_challenge_methods_supported" not in metadata and settings.OIDC_PROVIDER == "microsoft":
        # Entra's discovery omits this optional field. Microsoft's official
        # authorization-code documentation confirms S256. Settings restrict
        # this reviewed exception to an exact public-cloud tenant UUID issuer.
        # The actual authorization request/exchange still always uses PKCE.
        pass
    elif "S256" not in metadata.get("code_challenge_methods_supported", []):
        raise ValueError("Provider must advertise PKCE S256 support.")
    if "code" not in metadata.get("response_types_supported", []):
        raise ValueError("Provider must support the authorization code flow.")
    return metadata
