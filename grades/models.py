import re
import uuid
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


def validate_year(value):
    if not re.fullmatch(r"\d{4}-\d{4}", value) or int(value[5:]) != int(value[:4]) + 1:
        raise ValidationError("Use consecutive years, for example 2026-2027.")


class Subject(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    year = models.CharField(max_length=9, validators=[validate_year])

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(fields=["owner", "year", "name"], name="unique_owner_year_subject")
        ]

    def __str__(self):
        return self.name


class Assessment(models.Model):
    class Source(models.TextChoices):
        MANUAL = "manual", "Manual entry"
        CSV = "csv", "CSV import"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(Subject, related_name="assessments", on_delete=models.CASCADE)
    title = models.CharField(max_length=120)
    earned = models.DecimalField(max_digits=10, decimal_places=4, validators=[MinValueValidator(0)])
    possible = models.DecimalField(max_digits=10, decimal_places=4, validators=[MinValueValidator(Decimal("0.0001"))])
    weight = models.DecimalField(max_digits=10, decimal_places=4, default=1, validators=[MinValueValidator(Decimal("0.0001")), MaxValueValidator(Decimal("999999"))])
    date = models.DateField()
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)

    class Meta:
        ordering = ["-date", "title", "id"]
        constraints = [
            models.CheckConstraint(condition=models.Q(earned__gte=0), name="earned_nonnegative"),
            models.CheckConstraint(condition=models.Q(possible__gt=0), name="possible_positive"),
            models.CheckConstraint(condition=models.Q(weight__gt=0), name="weight_positive"),
            models.CheckConstraint(condition=models.Q(earned__lte=models.F("possible")), name="earned_lte_possible"),
        ]

    def clean(self):
        super().clean()
        if self.earned is not None and self.possible is not None and self.earned > self.possible:
            raise ValidationError({"earned": "Score cannot exceed the maximum. Extra credit is not supported."})

    @property
    def percentage(self):
        return self.earned / self.possible * 100

    def __str__(self):
        return self.title
