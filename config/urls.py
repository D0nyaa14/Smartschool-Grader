from django.urls import include, path

urlpatterns = [
    path("auth/", include("identity.urls")),
    path("", include("grades.urls")),
]
