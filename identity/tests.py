"""Security boundary tests: real Authlib protocol/JWT validation, fake provider."""
import base64
import hashlib
import json
import os
import runpy
import time
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import requests
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.test import Client, SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from .oidc import subject_username


def b64(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def integer_b64(value):
    return b64(value.to_bytes((value.bit_length() + 7) // 8, "big"))


@override_settings(
    DEBUG=True, ALLOW_DEMO_LOGIN=True,
    ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost", "[::1]"],
    STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage",
    STORAGES={"staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}},
)
class LocalBoundaryTests(TestCase):
    def test_demo_requires_both_local_host_and_loopback_peer(self):
        url = reverse("identity:demo_login")
        self.assertEqual(self.client.post(url).status_code, 404)  # testserver
        self.assertEqual(self.client.post(url, HTTP_HOST="localhost", REMOTE_ADDR="192.0.2.1").status_code, 404)
        self.assertEqual(self.client.post(url, HTTP_HOST="localhost", REMOTE_ADDR="not-an-ip").status_code, 404)
        response = self.client.post(url, HTTP_HOST="127.0.0.1", REMOTE_ADDR="127.0.0.1")
        self.assertRedirects(response, reverse("grades:dashboard"), fetch_redirect_response=False)
        self.assertEqual(get_user_model().objects.get(pk=self.client.session["_auth_user_id"]).username, "demo-student")
        self.assertFalse(get_user_model().objects.get(username="demo-student").has_usable_password())
        self.assertTrue(self.client.session["identity_demo"])

    @override_settings(DEBUG=False, ALLOW_DEMO_LOGIN=True)
    def test_demo_runtime_guard_blocks_production(self):
        response = self.client.post(reverse("identity:demo_login"), HTTP_HOST="localhost", REMOTE_ADDR="127.0.0.1")
        self.assertEqual(response.status_code, 404)

    @override_settings(ALLOW_DEMO_LOGIN=False)
    def test_demo_requires_opt_in(self):
        self.assertEqual(self.client.post(reverse("identity:demo_login"), HTTP_HOST="localhost").status_code, 404)

    def test_all_session_mutations_require_post_and_csrf(self):
        client = Client(enforce_csrf_checks=True)
        for name in ("demo_login", "school_login", "logout"):
            url = reverse("identity:" + name)
            self.assertEqual(client.get(url).status_code, 405)
            self.assertEqual(client.post(url).status_code, 403)

    def test_passwords_cannot_authenticate_and_logout_flushes_session(self):
        user = get_user_model().objects.create_user(username="someone", password="a-long-test-password")
        self.assertIsNone(authenticate(username=user.username, password="a-long-test-password"))
        self.client.force_login(user)
        response = self.client.post(reverse("identity:logout"))
        self.assertEqual(response.status_code, 302)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_private_headers_are_set(self):
        response = self.client.get(reverse("identity:login"))
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(response["Referrer-Policy"], "strict-origin")
        self.assertIn("frame-ancestors 'none'", response["Content-Security-Policy"])
        self.assertNotIn("unsafe-inline", response["Content-Security-Policy"])

    def test_same_origin_form_post_succeeds_but_null_and_foreign_origins_fail(self):
        # A browser must keep the real Origin when submitting this form.
        # strict-origin omits private paths/queries while retaining that header.
        client = Client(enforce_csrf_checks=True)
        page = client.get(reverse("identity:login"), HTTP_HOST="127.0.0.1:8000")
        self.assertEqual(page["Referrer-Policy"], "strict-origin")
        token = client.cookies[settings.CSRF_COOKIE_NAME].value
        response = client.post(
            reverse("identity:demo_login"), {"csrfmiddlewaretoken": token},
            HTTP_HOST="127.0.0.1:8000", HTTP_ORIGIN="http://127.0.0.1:8000",
            REMOTE_ADDR="127.0.0.1",
        )
        self.assertEqual(response.status_code, 302)
        token = client.cookies[settings.CSRF_COOKIE_NAME].value
        for origin in ("null", "https://attacker.example"):
            with self.subTest(origin=origin):
                response = client.post(
                    reverse("identity:logout"), {"csrfmiddlewaretoken": token},
                    HTTP_HOST="127.0.0.1:8000", HTTP_ORIGIN=origin,
                )
                self.assertEqual(response.status_code, 403)
        self.assertIn("_auth_user_id", client.session)


@override_settings(
    DEBUG=True, OIDC_CONFIGURED=True, OIDC_PROVIDER="generic",
    ALLOWED_HOSTS=["testserver", "127.0.0.1"],
    APP_BASE_URL="http://127.0.0.1:8000",
    OIDC_REDIRECT_URI="http://127.0.0.1:8000/auth/callback/",
    OIDC_ISSUER_URL="https://school.example/tenant",
    OIDC_CLIENT_ID="grade-dashboard", OIDC_CLIENT_SECRET="test-client-secret",
    OIDC_TOKEN_ENDPOINT_AUTH_METHOD="client_secret_basic",
    STORAGES={"staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}},
)
class OIDCProtocolTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        numbers = cls.private_key.public_key().public_numbers()
        cls.jwk = {"kty": "RSA", "kid": "school-key", "use": "sig", "alg": "RS256", "n": integer_b64(numbers.n), "e": integer_b64(numbers.e)}

    def setUp(self):
        self.issuer = settings.OIDC_ISSUER_URL
        self.metadata = {
            "issuer": self.issuer,
            "authorization_endpoint": "https://school.example/authorize",
            "token_endpoint": "https://school.example/token",
            "jwks_uri": "https://school.example/jwks",
            "id_token_signing_alg_values_supported": ["RS256"],
            "response_types_supported": ["code"],
            "code_challenge_methods_supported": ["S256"],
        }
        self.claim_overrides = {}
        self.signing_key = self.private_key
        self.sub = "school-student-123"
        self.email = "student@school.example"
        self.token_requests = []
        self.provider_patch = patch("requests.sessions.Session.send", autospec=True, side_effect=self.provider)
        self.provider_patch.start()
        self.addCleanup(self.provider_patch.stop)

    def signed_token(self):
        now = int(time.time())
        claims = {
            "iss": self.issuer, "sub": self.sub, "aud": settings.OIDC_CLIENT_ID,
            "iat": now, "exp": now + 300, "nonce": self.authorization["nonce"][0],
            "email": self.email,
        }
        claims.update(self.claim_overrides)
        header = b64(json.dumps({"alg": "RS256", "kid": "school-key"}).encode())
        body = b64(json.dumps(claims).encode())
        signing_input = (header + "." + body).encode()
        signature = self.signing_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
        return signing_input.decode() + "." + b64(signature)

    def provider(self, session, prepared, **kwargs):
        self.assertEqual(kwargs.get("timeout"), 10)
        if prepared.url == self.issuer + "/.well-known/openid-configuration":
            data = self.metadata
        elif prepared.url == self.metadata["jwks_uri"]:
            data = {"keys": [self.jwk]}
        elif prepared.url == self.metadata["token_endpoint"]:
            params = parse_qs(prepared.body)
            self.assertEqual(prepared.method, "POST")
            self.assertEqual(params["redirect_uri"], [settings.OIDC_REDIRECT_URI])
            self.assertEqual(params["grant_type"], ["authorization_code"])
            self.assertEqual(params["code"], ["provider-code"])
            self.assertEqual(b64(hashlib.sha256(params["code_verifier"][0].encode()).digest()), self.authorization["code_challenge"][0])
            if settings.OIDC_TOKEN_ENDPOINT_AUTH_METHOD == "client_secret_basic":
                self.assertTrue(prepared.headers["Authorization"].startswith("Basic "))
            else:
                self.assertNotIn("Authorization", prepared.headers)
                self.assertEqual(params["client_id"], [settings.OIDC_CLIENT_ID])
                self.assertEqual(params["client_secret"], [settings.OIDC_CLIENT_SECRET])
            self.token_requests.append(params)
            data = {"access_token": "opaque-access-token", "token_type": "Bearer", "id_token": self.signed_token()}
        else:
            raise AssertionError("Unexpected provider request")
        response = requests.Response()
        response.status_code = 200
        response._content = json.dumps(data).encode()
        response.headers["Content-Type"] = "application/json"
        response.request = prepared
        response.url = prepared.url
        return response

    def begin(self):
        response = self.client.post(reverse("identity:school_login"))
        self.assertEqual(response.status_code, 302)
        self.assertIn("form-action 'self' https://school.example", response["Content-Security-Policy"])
        self.authorization = parse_qs(urlsplit(response["Location"]).query)
        self.assertEqual(self.authorization["redirect_uri"], [settings.OIDC_REDIRECT_URI])
        self.assertEqual(self.authorization["code_challenge_method"], ["S256"])
        self.assertEqual(self.authorization["response_type"], ["code"])
        self.assertTrue(self.authorization["state"][0])
        self.assertTrue(self.authorization["nonce"][0])
        return self.authorization["state"][0]

    def finish(self, state):
        return self.client.get(reverse("identity:callback"), {"state": state, "code": "provider-code"})

    def test_code_exchange_checks_pkce_and_identity_without_storing_tokens(self):
        state = self.begin()
        response = self.finish(state)
        self.assertRedirects(response, reverse("grades:dashboard"), fetch_redirect_response=False)
        user = get_user_model().objects.get(pk=self.client.session["_auth_user_id"])
        self.assertEqual(user.username, subject_username(self.issuer, self.sub))
        self.assertFalse(user.has_usable_password())
        self.assertEqual(user.email, "")
        self.assertNotIn("opaque-access-token", json.dumps(dict(self.client.session)))
        self.assertNotIn("id_token", dict(self.client.session))
        self.assertEqual(self.finish(state).status_code, 400)  # state consumed once
        self.assertEqual(len(self.token_requests), 1)

    def test_login_document_allows_only_validated_provider_form_redirect(self):
        response = self.client.get(reverse("identity:login"))
        self.assertEqual(response.status_code, 200)
        self.assertIn("form-action 'self' https://school.example", response["Content-Security-Policy"])
        self.metadata["issuer"] = "https://untrusted.example"
        response = self.client.get(reverse("identity:login"))
        self.assertNotIn("form-action 'self' https://school.example", response["Content-Security-Policy"])

    def test_state_mismatch_never_exchanges_code(self):
        self.begin()
        self.assertEqual(self.finish("attacker-state").status_code, 400)
        self.assertFalse(self.token_requests)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_invalid_signature_never_logs_in(self):
        state = self.begin()
        self.signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.assertEqual(self.finish(state).status_code, 400)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_invalid_nonce_issuer_audience_and_expiry_are_rejected(self):
        invalid = [
            {"nonce": "attacker-nonce"},
            {"nonce": None, "nonce_supported": False},
            {"iss": "https://attacker.example"},
            {"aud": "another-application"},
            {"exp": int(time.time()) - 1000},
        ]
        for claims in invalid:
            with self.subTest(claims=claims):
                state = self.begin()
                self.claim_overrides = claims
                self.assertEqual(self.finish(state).status_code, 400)
                self.assertNotIn("_auth_user_id", self.client.session)

    def test_discovery_issuer_must_match_exact_school(self):
        self.metadata["issuer"] = "https://different-school.example"
        self.assertEqual(self.client.post(reverse("identity:school_login")).status_code, 400)

    def test_insecure_endpoints_and_missing_pkce_are_rejected(self):
        self.metadata["token_endpoint"] = "http://school.example/token"
        self.assertEqual(self.client.post(reverse("identity:school_login")).status_code, 400)
        self.metadata["token_endpoint"] = "https://school.example/token"
        self.metadata["code_challenge_methods_supported"] = ["plain"]
        self.assertEqual(self.client.post(reverse("identity:school_login")).status_code, 400)

    def test_generic_provider_missing_pkce_metadata_is_rejected(self):
        self.metadata.pop("code_challenge_methods_supported")
        self.assertEqual(self.client.post(reverse("identity:school_login")).status_code, 400)

    def test_microsoft_compatibility_still_uses_real_s256_exchange(self):
        issuer = "https://login.microsoftonline.com/12345678-1234-1234-1234-123456789abc/v2.0"
        self.issuer = issuer
        self.metadata["issuer"] = issuer
        self.metadata.pop("code_challenge_methods_supported")
        with self.settings(OIDC_PROVIDER="microsoft", OIDC_ISSUER_URL=issuer, OIDC_TOKEN_ENDPOINT_AUTH_METHOD="client_secret_post"):
            state = self.begin()
            self.assertEqual(self.finish(state).status_code, 302)
            self.assertEqual(len(self.token_requests), 1)
            self.client.post(reverse("identity:logout"))
            self.metadata["code_challenge_methods_supported"] = ["plain"]
            self.assertEqual(self.client.post(reverse("identity:school_login")).status_code, 400)

    def test_same_email_does_not_link_distinct_subjects(self):
        self.assertEqual(self.finish(self.begin()).status_code, 302)
        first_id = self.client.session["_auth_user_id"]
        self.client.post(reverse("identity:logout"))
        self.sub = "different-student"
        self.assertEqual(self.finish(self.begin()).status_code, 302)
        self.assertNotEqual(first_id, self.client.session["_auth_user_id"])

    def test_same_subject_survives_email_change(self):
        self.assertEqual(self.finish(self.begin()).status_code, 302)
        first_id = self.client.session["_auth_user_id"]
        self.client.post(reverse("identity:logout"))
        self.email = "new-email@school.example"
        self.assertEqual(self.finish(self.begin()).status_code, 302)
        self.assertEqual(first_id, self.client.session["_auth_user_id"])


class ProductionConfigurationTests(SimpleTestCase):
    def load_config(self, **changes):
        environment = {
            "DEBUG": "False", "ALLOW_DEMO_LOGIN": "False", "SECRET_KEY": "s" * 64,
            "ALLOWED_HOSTS": "grades.example", "CSRF_TRUSTED_ORIGINS": "https://grades.example",
            "APP_BASE_URL": "https://grades.example", "OIDC_REDIRECT_URI": "https://grades.example/auth/callback/",
            "OIDC_ISSUER_URL": "https://school.example/tenant", "OIDC_CLIENT_ID": "school-client",
            "OIDC_CLIENT_SECRET": "test-secret",
        }
        environment.update(changes)
        with patch.dict(os.environ, environment, clear=True), patch("dotenv.load_dotenv"):
            return runpy.run_path(str(Path(__file__).resolve().parent.parent / "config" / "settings.py"))

    def test_complete_production_uses_secure_cookies(self):
        config = self.load_config()
        self.assertTrue(config["SESSION_COOKIE_SECURE"])
        self.assertTrue(config["CSRF_COOKIE_SECURE"])
        self.assertTrue(config["SECURE_SSL_REDIRECT"])

    def test_incomplete_or_unsafe_production_fails_closed(self):
        cases = [
            {"SECRET_KEY": ""}, {"OIDC_CLIENT_SECRET": ""}, {"ALLOWED_HOSTS": "*"},
            {"CSRF_TRUSTED_ORIGINS": ""}, {"ALLOW_DEMO_LOGIN": "True"},
            {"APP_BASE_URL": "http://grades.example"},
            {"OIDC_REDIRECT_URI": "https://attacker.example/auth/callback/"},
            {"OIDC_ISSUER_URL": "http://school.example"},
        ]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(ImproperlyConfigured):
                self.load_config(**changes)

    def test_identity_key_includes_issuer(self):
        self.assertNotEqual(subject_username("https://school-a.example", "123"), subject_username("https://school-b.example", "123"))

    def test_microsoft_mode_requires_exact_public_cloud_tenant_uuid_issuer(self):
        self.load_config(OIDC_PROVIDER="microsoft", OIDC_ISSUER_URL="https://login.microsoftonline.com/12345678-1234-1234-1234-123456789abc/v2.0")
        invalid = [
            "https://login.microsoftonline.com/common/v2.0",
            "https://login.microsoftonline.com/organizations/v2.0",
            "https://login.microsoftonline.com/consumers/v2.0",
            "https://login.microsoftonline.com/school.onmicrosoft.com/v2.0",
            "https://evil.example/12345678-1234-1234-1234-123456789abc/v2.0",
            "https://login.microsoftonline.com/12345678-1234-1234-1234-123456789abc/v2.0/",
        ]
        for issuer in invalid:
            with self.subTest(issuer=issuer), self.assertRaises(ImproperlyConfigured):
                self.load_config(OIDC_PROVIDER="microsoft", OIDC_ISSUER_URL=issuer)
