class PrivacyHeadersMiddleware:
    """Prevent shared caches, framing and third-party scripts on private pages."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        # Browsers can apply form-action to a POST's redirect destination.
        # Only login/SSO-start views supply an origin from validated discovery.
        provider_origin = getattr(response, "_school_authorization_origin", "")
        form_action = "'self'" + (" " + provider_origin if provider_origin else "")
        response["Cache-Control"] = "no-store, private, max-age=0"
        response["Pragma"] = "no-cache"
        response["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data:; font-src 'self'; connect-src 'self'; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action " + form_action
        )
        response["Referrer-Policy"] = "strict-origin"
        response["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response
