import csv
from datetime import date

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import IntegrityError, transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_GET, require_http_methods
from django.templatetags.static import static

from .calculations import percentage, simulate, totals
from .forms import FutureFormSet, GradeForm, ImportForm, SubjectForm, TargetForm
from .importing import COLUMNS, MAX_ROWS, ImportProblem, import_grades
from .models import Assessment, Subject


@require_GET
def guest(request):
    # This public page contains no server records, user details, or templates
    # evaluated from user content. The same standalone source also works on Pages.
    page = (settings.BASE_DIR / "guest-site" / "index.html").read_text(encoding="utf-8")
    page = page.replace("./assets/app.css", static("guest/app.css"))
    page = page.replace("./assets/app.js", static("guest/app.js"))
    page = page.replace('data-school-login=""', 'data-school-login="' + reverse("identity:login") + '"')
    return HttpResponse(page)


def school_year():
    today = date.today()
    start = today.year if today.month >= 9 else today.year - 1
    return f"{start}-{start + 1}"


def owned_subject(request, pk):
    return get_object_or_404(Subject, pk=pk, owner=request.user)


def owned_grade(request, pk):
    return get_object_or_404(Assessment.objects.select_related("subject"), pk=pk, subject__owner=request.user)


@login_required
@require_GET
def dashboard(request):
    owned = Subject.objects.filter(owner=request.user)
    years = sorted(set(owned.values_list("year", flat=True)) | {school_year()}, reverse=True)
    selected = request.GET.get("year", years[0])
    if selected not in years:
        selected = years[0]
    subjects = list(owned.filter(year=selected).prefetch_related("assessments"))
    count = 0
    for subject in subjects:
        records = list(subject.assessments.all())
        subject.current_percentage = percentage(records)
        subject.assessment_count = len(records)
        subject.total_weight = totals(records)[1]
        count += len(records)
    return render(request, "grades/dashboard.html", {"academic_year": selected, "years": years, "subjects": subjects, "assessment_total": count})


@login_required
@require_http_methods(["GET", "POST"])
def subject_detail(request, pk):
    subject = owned_subject(request, pk)
    records = list(subject.assessments.all())
    bound = request.POST if request.method == "POST" else None
    target_form = TargetForm(bound)
    future_formset = FutureFormSet(bound, prefix="future")
    simulation = None
    if request.method == "POST":
        target_valid, future_valid = target_form.is_valid(), future_formset.is_valid()
        if target_valid and future_valid:
            future = [form.cleaned_data for form in future_formset if form.cleaned_data]
            simulation = simulate(records, future, target_form.cleaned_data["target_percentage"])
    weighted, weight = totals(records)
    return render(request, "grades/subject_detail.html", {
        "subject": subject, "assessments": records, "current_percentage": percentage(records),
        "weighted_total": weighted, "total_weight": weight,
        "simulator_form": target_form, "future_formset": future_formset, "simulation": simulation,
    })


@login_required
@require_http_methods(["GET", "POST"])
def subject_create(request):
    form = SubjectForm(request.POST or None, initial={"year": school_year()})
    if request.method == "POST" and form.is_valid():
        subject = form.save(commit=False)
        subject.owner = request.user
        try:
            with transaction.atomic():
                subject.save()
        except IntegrityError:
            form.add_error("name", "You already have this subject in that school year.")
        else:
            messages.success(request, "Subject added. You can now enter your grades.")
            return redirect("grades:subject_detail", pk=subject.pk)
    return render(request, "grades/subject_form.html", {"form": form})


@login_required
@require_http_methods(["GET", "POST"])
def grade_create(request, pk):
    subject = owned_subject(request, pk)
    form = GradeForm(request.POST or None, initial={"date": date.today(), "weight": 1})
    if request.method == "POST" and form.is_valid():
        grade = form.save(commit=False)
        grade.subject, grade.source = subject, Assessment.Source.MANUAL
        grade.save()
        messages.success(request, "Grade saved.")
        return redirect("grades:subject_detail", pk=subject.pk)
    return render(request, "grades/grade_form.html", {"form": form, "subject": subject})


@login_required
@require_http_methods(["GET", "POST"])
def grade_update(request, pk):
    grade = owned_grade(request, pk)
    form = GradeForm(request.POST or None, instance=grade)
    if request.method == "POST" and form.is_valid():
        changed = form.save(commit=False)
        changed.source = Assessment.Source.MANUAL
        changed.save()
        messages.success(request, "Grade updated.")
        return redirect("grades:subject_detail", pk=grade.subject_id)
    return render(request, "grades/grade_form.html", {"form": form, "subject": grade.subject, "assessment": grade})


@login_required
@require_http_methods(["GET", "POST"])
def grade_delete(request, pk):
    grade = owned_grade(request, pk)
    cancel_url = reverse("grades:subject_detail", kwargs={"pk": grade.subject_id})
    if request.method == "POST":
        grade.delete()
        messages.success(request, "Grade deleted.")
        return redirect(cancel_url)
    return render(request, "grades/confirm_delete.html", {"object": grade, "kind": "assessment", "cancel_url": cancel_url})


@login_required
@require_http_methods(["GET", "POST"])
def subject_delete(request, pk):
    subject = owned_subject(request, pk)
    if request.method == "POST":
        subject.delete()
        messages.success(request, "Subject and its grades deleted.")
        return redirect("grades:dashboard")
    return render(request, "grades/confirm_delete.html", {"object": subject, "kind": "subject", "cancel_url": reverse("grades:dashboard")})


@login_required
@require_http_methods(["GET", "POST"])
def import_csv(request):
    form = ImportForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        try:
            imported, skipped = import_grades(form.cleaned_data["file"], request.user)
        except ImportProblem as exc:
            form.add_error("file", str(exc))
        else:
            messages.success(request, f"Imported {imported} grades. Skipped {skipped} exact duplicates.")
            return redirect("grades:dashboard")
    return render(request, "grades/import.html", {"form": form, "csv_columns": ",".join(COLUMNS), "max_rows": MAX_ROWS})


def spreadsheet_safe(value):
    text = str(value)
    candidate = text.lstrip().lstrip("\ufeff").lstrip()
    return "'" + text if candidate.startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r", "\n")) else text


@login_required
@require_GET
def export_csv(request):
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="my-grades.csv"'
    writer = csv.writer(response)
    writer.writerow(COLUMNS)
    for grade in Assessment.objects.filter(subject__owner=request.user).select_related("subject").order_by("subject__year", "subject__name", "date", "pk"):
        writer.writerow([grade.subject.year, spreadsheet_safe(grade.subject.name), spreadsheet_safe(grade.title), grade.earned, grade.possible, grade.weight, grade.date.isoformat()])
    return response


@login_required
@require_http_methods(["GET", "POST"])
def delete_data(request):
    owned = Subject.objects.filter(owner=request.user)
    error = None
    if request.method == "POST":
        if request.POST.get("confirmation") == "DELETE":
            owned.delete()
            messages.success(request, "All your subjects and grades were deleted. Your school sign-in is still connected.")
            return redirect("grades:dashboard")
        error = "Type DELETE to confirm removal of all your grades."
    return render(request, "grades/data_delete.html", {
        "subject_count": owned.count(), "assessment_count": Assessment.objects.filter(subject__owner=request.user).count(),
        "error": error, "cancel_url": reverse("grades:dashboard"),
    })
