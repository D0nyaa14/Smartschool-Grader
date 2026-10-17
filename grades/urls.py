from django.urls import path
from . import views

app_name = "grades"
urlpatterns = [
    path("guest/", views.guest, name="guest"),
    path("", views.dashboard, name="dashboard"),
    path("subjects/new/", views.subject_create, name="subject_create"),
    path("subjects/<uuid:pk>/", views.subject_detail, name="subject_detail"),
    path("subjects/<uuid:pk>/delete/", views.subject_delete, name="subject_delete"),
    path("subjects/<uuid:pk>/grades/new/", views.grade_create, name="grade_create"),
    path("grades/<uuid:pk>/edit/", views.grade_update, name="grade_update"),
    path("grades/<uuid:pk>/delete/", views.grade_delete, name="grade_delete"),
    path("import/", views.import_csv, name="import_csv"),
    path("export/", views.export_csv, name="export_csv"),
    path("data/delete/", views.delete_data, name="delete_data"),
]
