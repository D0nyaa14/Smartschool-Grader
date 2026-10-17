from django.contrib.auth import get_user_model


class SchoolSessionBackend:
    """Restore a verified SSO session; intentionally never authenticate passwords."""

    def authenticate(self, request, **credentials):
        return None

    def get_user(self, user_id):
        try:
            user = get_user_model().objects.get(pk=user_id)
        except get_user_model().DoesNotExist:
            return None
        return user if user.is_active else None
