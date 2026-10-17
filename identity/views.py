import ipaddress
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.http import HttpResponseNotFound
from django.shortcuts import redirect, render
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from django.views.decorators.http import require_GET, require_POST

from .oidc import get_oidc_client, subject_username, validate_metadata

BACKEND = "identity.backends.SchoolSessionBackend"


def demo_allowed(request):
    if not settings.DEBUG or not settings.ALLOW_DEMO_LOGIN:
        return False
    host = urlsplit("//" + request.get_host()).hostname
    if host not in {"localhost", "127.0.0.1", "::1"}:
        return False
    try:
        return ipaddress.ip_address(request.META.get("REMOTE_ADDR", "")).is_loopback
    except ValueError:
        return False


@require_GET
def login_page(request):
    if request.user.is_authenticated:
        return redirect("grades:dashboard")
    response = render(request, "identity/login.html", {
        "sso_configured": settings.OIDC_CONFIGURED,
        "sso_enabled": settings.OIDC_CONFIGURED,
        "demo_enabled": demo_allowed(request),
    })
    if settings.OIDC_CONFIGURED:
        try:
            metadata = validate_metadata(get_oidc_client())
            endpoint = urlsplit(metadata["authorization_endpoint"])
            response._school_authorization_origin = endpoint.scheme + "://" + endpoint.netloc
        except Exception:
            pass  # Sign-in fails closed; never expose provider/network diagnostics.
    return response


def auth_error(request):
    # Provider messages and exception details may contain secrets; never display them.
    return render(request, "identity/error.html", status=400)


@require_POST
@sensitive_variables()
@sensitive_post_parameters()
def school_login(request):
    if not settings.OIDC_CONFIGURED:
        return auth_error(request)
    try:
        client = get_oidc_client()
        metadata = validate_metadata(client)
        request.session.cycle_key()
        response = client.authorize_redirect(request, settings.OIDC_REDIRECT_URI, response_mode="query")
        endpoint = urlsplit(metadata["authorization_endpoint"])
        response._school_authorization_origin = endpoint.scheme + "://" + endpoint.netloc
        return response
    except Exception:
        # Fail closed on discovery, network, provider and protocol errors.
        return auth_error(request)


@require_GET
@sensitive_variables()
def callback(request):
    if not settings.OIDC_CONFIGURED:
        return auth_error(request)
    if any(len(request.GET.getlist(key)) != 1 for key in ("state", "code")):
        return auth_error(request)
    if not request.GET.get("state") or not request.GET.get("code") or request.GET.get("error"):
        return auth_error(request)
    try:
        client = get_oidc_client()
        validate_metadata(client)
        # Authlib checks single-use session state, PKCE verifier, ID-token
        # signature, nonce, issuer, audience, azp, timestamps and at_hash.
        token = client.authorize_access_token(
            request, claims_options={"iss": {"essential": True, "value": settings.OIDC_ISSUER_URL}},
            leeway=60,
        )
        claims = token.get("userinfo")
        if not token.get("id_token") or not claims or claims.get("iss") != settings.OIDC_ISSUER_URL:
            return auth_error(request)
        username = subject_username(settings.OIDC_ISSUER_URL, claims.get("sub"))
        user, created = get_user_model().objects.get_or_create(username=username)
        if created:
            user.set_unusable_password()
            user.save(update_fields=["password"])
        if not user.is_active:
            return auth_error(request)
        # Do not retain access/refresh/ID tokens or arbitrary claims in sessions.
        login(request, user, backend=BACKEND)
        request.session.pop("identity_demo", None)
        return redirect("grades:dashboard")
    except Exception:
        return auth_error(request)


@require_POST
def demo_login(request):
    if not demo_allowed(request):
        return HttpResponseNotFound()
    user, created = get_user_model().objects.get_or_create(username="demo-student")
    if created:
        user.set_unusable_password()
        user.save(update_fields=["password"])
    if not user.is_active:
        return HttpResponseNotFound()
    login(request, user, backend=BACKEND)
    request.session["identity_demo"] = True
    return redirect("grades:dashboard")


@require_POST
def logout_view(request):
    logout(request)
    return redirect("identity:login")
