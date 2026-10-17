from django.urls import path
from . import views

app_name = "identity"
urlpatterns = [
    path("login/", views.login_page, name="login"),
    path("school/", views.school_login, name="school_login"),
    path("callback/", views.callback, name="callback"),
    path("demo/", views.demo_login, name="demo_login"),
    path("logout/", views.logout_view, name="logout"),
]
