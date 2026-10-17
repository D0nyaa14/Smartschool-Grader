from datetime import date
from decimal import Decimal
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from grades.models import Assessment, Subject


class Command(BaseCommand):
    help = "Add synthetic grades to the local-only demo student. Safe to repeat."

    def handle(self, *args, **options):
        if not settings.DEBUG or not settings.ALLOW_DEMO_LOGIN:
            raise CommandError("Demo data requires DEBUG=True and ALLOW_DEMO_LOGIN=True.")
        user, _ = get_user_model().objects.get_or_create(username="demo-student", defaults={"first_name": "Alex"})
        user.set_unusable_password()
        user.save()
        subjects = {
            "Mathematics": [("Algebra quiz", 17, 20, 1), ("Functions & graphs", 38, 50, 2), ("Problem-solving task", 18, 20, 1)],
            "English": [("Literary analysis", 42, 50, 2), ("Reading response", 18, 20, 1), ("Presentation", 27, 30, 1)],
            "Biology": [("Cell biology", 23, 30, 2), ("Lab report", 18, 20, 1)],
            "History": [("Sources assessment", 16, 20, 1), ("Research essay", 41, 50, 2)],
            "French": [("Listening", 18, 25, 1), ("Writing", 22, 25, 2)],
            "Physics": [("Motion and forces", 34, 40, 2), ("Practical investigation", 17, 20, 1)],
        }
        for name, records in subjects.items():
            subject, _ = Subject.objects.get_or_create(owner=user, year="2026-2027", name=name)
            for index, (title, earned, possible, weight) in enumerate(records):
                Assessment.objects.get_or_create(subject=subject, title=title, date=date(2026, 10, 5 + index * 3), defaults={"earned": Decimal(earned), "possible": Decimal(possible), "weight": Decimal(weight)})
        self.stdout.write(self.style.SUCCESS("Synthetic local demo ready. School SSO accounts do not receive these records."))
