"""Bounded, atomic, user-scoped CSV imports. No uploaded files are retained."""
import csv
import io
from datetime import date
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model
from django.db import transaction

from .models import Assessment, Subject

COLUMNS = ("year", "subject", "title", "earned", "possible", "weight", "date")
MAX_ROWS = 500
MAX_BYTES = 1_048_576


class ImportProblem(ValueError):
    pass


def import_grades(upload, owner):
    if upload.size > MAX_BYTES:
        raise ImportProblem("The CSV must be no larger than 1 MiB.")
    content = upload.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ImportProblem("The CSV must be no larger than 1 MiB.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ImportProblem("Save the file as UTF-8 CSV and try again.") from exc
    if "\x00" in text:
        raise ImportProblem("The CSV contains unsupported characters.")
    rows = []
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        if reader.fieldnames is None or len(reader.fieldnames) != len(COLUMNS) or set(reader.fieldnames) != set(COLUMNS):
            raise ImportProblem("Use exactly these column names: " + ",".join(COLUMNS))
        for number, row in enumerate(reader, start=2):
            if len(rows) >= MAX_ROWS:
                raise ImportProblem(f"Import at most {MAX_ROWS} records at a time.")
            if None in row or any(value is None for value in row.values()):
                raise ImportProblem(f"Row {number}: every column must have a value.")
            data = {key: value.strip() for key, value in row.items()}
            subject = Subject(owner=owner, name=data["subject"], year=data["year"])
            try:
                subject.full_clean(validate_unique=False, validate_constraints=False)
                numbers = {key: Decimal(data[key]) for key in ("earned", "possible", "weight")}
                if not all(value.is_finite() for value in numbers.values()):
                    raise ValueError("Non-finite number")
                parsed_date = date.fromisoformat(data["date"])
                if parsed_date.isoformat() != data["date"]:
                    raise ValueError("Date must use YYYY-MM-DD")
                grade = Assessment(subject=subject, title=data["title"], date=parsed_date, **numbers)
                grade.full_clean(exclude=["subject"], validate_unique=False, validate_constraints=False)
            except (ValidationError, ValueError, InvalidOperation) as exc:
                raise ImportProblem(f"Row {number}: check the school year, names, date, scores, and positive weight. Scores must be between 0 and maximum points.") from exc
            rows.append((subject.name, subject.year, grade))
    except csv.Error as exc:
        raise ImportProblem("The file is not valid CSV. Check quotes and commas.") from exc
    if not rows:
        raise ImportProblem("The CSV contains no grade records.")
    imported = skipped = 0
    with transaction.atomic():
        # Serialize imports per student on PostgreSQL, including new subjects.
        get_user_model().objects.select_for_update().get(pk=owner.pk)
        for name, year, grade in rows:
            subject, _ = Subject.objects.get_or_create(owner=owner, name=name, year=year)
            values = {key: getattr(grade, key) for key in ("title", "earned", "possible", "weight", "date")}
            if Assessment.objects.filter(subject=subject, **values).exists():
                skipped += 1
            else:
                Assessment.objects.create(subject=subject, source=Assessment.Source.CSV, **values)
                imported += 1
    return imported, skipped
