import csv
import io
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client, SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from .calculations import percentage, simulate
from .importing import COLUMNS, ImportProblem, import_grades
from .models import Assessment, Subject
from .views import spreadsheet_safe


def item(earned, possible=100, weight=1):
    return {"earned": Decimal(str(earned)), "possible": Decimal(str(possible)), "weight": Decimal(str(weight))}


class CalculationTests(SimpleTestCase):
    def test_weighted_percentages_are_not_mean_points(self):
        # 50% weighted once plus 90% weighted three times = 80%.
        self.assertEqual(percentage([item(1, 2, 1), item(9, 10, 3)]), 80)

    def test_points_based_weight_matches_ratio_of_point_totals(self):
        self.assertEqual(percentage([item(7, 10, 10), item(17, 20, 20)]), 80)

    def test_no_records_is_no_average_and_zero_is_a_real_score(self):
        self.assertIsNone(percentage([]))
        self.assertEqual(percentage([item(0)]), 0)

    def test_multiple_future_scores_and_target_inverse(self):
        result = simulate([item(60, 100, 2)], [item(80), item(100)], Decimal(75))
        self.assertEqual(result["projected_percentage"], 75)
        self.assertEqual(result["needed_percentage"], 90)
        self.assertEqual(result["status"], "achievable")

    def test_impossible_and_already_guaranteed_targets(self):
        self.assertEqual(simulate([item(0, 100, 9)], [item(100)], Decimal(50))["status"], "impossible")
        self.assertEqual(simulate([item(100, 100, 9)], [item(0)], Decimal(50))["status"], "already")

    def test_invalid_values_fail_instead_of_dividing_by_zero(self):
        for record in [item(1, 0), item(-1), item(101), item(1, 100, 0)]:
            with self.subTest(record=record), self.assertRaises(ValueError):
                percentage([record])


@override_settings(DEBUG=True, STORAGES={"staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}})
class GradeBoundaryTests(TestCase):
    def setUp(self):
        self.alice = get_user_model().objects.create_user(username="student-alice")
        self.bob = get_user_model().objects.create_user(username="student-bob")
        self.mine = Subject.objects.create(owner=self.alice, name="Mathematics", year="2026-2027")
        self.theirs = Subject.objects.create(owner=self.bob, name="Private subject", year="2026-2027")
        self.grade = Assessment.objects.create(subject=self.mine, title="My quiz", earned=8, possible=10, weight=2, date=date(2026, 10, 12))
        self.private_grade = Assessment.objects.create(subject=self.theirs, title="Private quiz", earned=3, possible=10, weight=1, date=date(2026, 10, 12))
        self.client.force_login(self.alice)

    def test_anonymous_cannot_read_dashboard_or_export(self):
        self.client.logout()
        for name in ("dashboard", "export_csv", "import_csv", "delete_data", "subject_create"):
            self.assertEqual(self.client.get(reverse("grades:" + name)).status_code, 302)

    def test_guest_page_has_no_server_records_or_authenticated_session(self):
        visitor = Client()
        response = visitor.get(reverse("grades:guest"))
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "Private subject")
        self.assertNotContains(response, "Private quiz")
        self.assertNotContains(response, "student-alice")
        self.assertContains(response, "/static/guest/app.js")
        self.assertContains(response, 'data-school-login="/auth/login/"')
        self.assertNotIn("sessionid", response.cookies)
        self.assertNotIn("_auth_user_id", visitor.session)
        self.assertEqual(visitor.get(reverse("grades:export_csv")).status_code, 302)
        self.assertEqual(visitor.get(reverse("grades:subject_detail", args=[self.mine.pk])).status_code, 302)
        self.assertEqual(visitor.post(reverse("grades:guest"), {}).status_code, 405)

    def test_dashboard_and_export_show_only_current_student(self):
        response = self.client.get(reverse("grades:dashboard"), {"year": "2026-2027"})
        self.assertContains(response, "Mathematics")
        self.assertNotContains(response, "Private subject")
        export = self.client.get(reverse("grades:export_csv"))
        self.assertIn("My quiz", export.content.decode())
        self.assertNotIn("Private quiz", export.content.decode())
        self.assertIn("no-store", response["Cache-Control"])

    def test_other_students_objects_return_404_for_reads_and_writes(self):
        names = [("subject_detail", self.theirs.pk), ("subject_delete", self.theirs.pk), ("grade_create", self.theirs.pk), ("grade_update", self.private_grade.pk), ("grade_delete", self.private_grade.pk)]
        for name, pk in names:
            for method in (self.client.get, self.client.post):
                with self.subTest(name=name, method=method.__name__):
                    self.assertEqual(method(reverse("grades:" + name, args=[pk]), {}).status_code, 404)
        self.assertTrue(Assessment.objects.filter(pk=self.private_grade.pk).exists())

    def test_forged_owner_and_subject_are_ignored(self):
        response = self.client.post(reverse("grades:grade_create", args=[self.mine.pk]), {"title": "New grade", "earned": 5, "possible": 10, "weight": 1, "date": "2026-10-13", "subject": self.theirs.pk, "owner": self.bob.pk, "source": "csv"})
        self.assertEqual(response.status_code, 302)
        added = Assessment.objects.get(title="New grade")
        self.assertEqual(added.subject_id, self.mine.pk)
        self.assertEqual(added.source, "manual")

    def test_duplicate_subject_is_a_form_error(self):
        response = self.client.post(reverse("grades:subject_create"), {"name": "Mathematics", "year": "2026-2027"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Subject.objects.filter(owner=self.alice).count(), 1)
        self.assertTrue(response.context["form"].errors)

    def test_simulation_does_not_save_hypothetical_grades(self):
        payload = {"target_percentage": "85", "future-TOTAL_FORMS": "3", "future-INITIAL_FORMS": "0", "future-MIN_NUM_FORMS": "0", "future-MAX_NUM_FORMS": "3", "future-0-earned": "10", "future-0-possible": "10", "future-0-weight": "2"}
        response = self.client.post(reverse("grades:subject_detail", args=[self.mine.pk]), payload)
        self.assertEqual(response.context["simulation"]["projected_percentage"], 90)
        self.assertEqual(response.context["simulation"]["needed_percentage"], 90)
        self.assertEqual(self.mine.assessments.count(), 1)
        payload["future-0-possible"] = "0"
        response = self.client.post(reverse("grades:subject_detail", args=[self.mine.pk]), payload)
        self.assertIsNone(response.context["simulation"])
        self.assertTrue(response.context["future_formset"].errors)

    def test_zero_grade_and_ungraded_subject_render_distinctly(self):
        self.grade.earned = 0
        self.grade.save()
        empty = Subject.objects.create(owner=self.alice, name="Empty", year="2026-2027")
        response = self.client.get(reverse("grades:subject_detail", args=[self.mine.pk]))
        self.assertEqual(response.context["current_percentage"], 0)
        response = self.client.get(reverse("grades:subject_detail", args=[empty.pk]))
        self.assertIsNone(response.context["current_percentage"])

    def test_unsafe_score_inputs_show_errors(self):
        for earned, possible, weight in [("NaN", "10", "1"), ("1", "0", "1"), ("11", "10", "1"), ("1", "10", "-1")]:
            response = self.client.post(reverse("grades:grade_create", args=[self.mine.pk]), {"title": "Invalid", "earned": earned, "possible": possible, "weight": weight, "date": "2026-10-13"})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.context["form"].errors)
        self.assertFalse(Assessment.objects.filter(title="Invalid").exists())

    def test_destructive_get_is_confirmation_only_and_delete_is_scoped(self):
        self.client.get(reverse("grades:subject_delete", args=[self.mine.pk]))
        self.assertTrue(Subject.objects.filter(pk=self.mine.pk).exists())
        response = self.client.post(reverse("grades:delete_data"), {"confirmation": "incorrect"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(Subject.objects.filter(pk=self.mine.pk).exists())
        self.client.post(reverse("grades:delete_data"), {"confirmation": "DELETE"})
        self.assertFalse(Subject.objects.filter(owner=self.alice).exists())
        self.assertTrue(Assessment.objects.filter(pk=self.private_grade.pk).exists())

    def test_mutations_require_csrf(self):
        secure_client = Client(enforce_csrf_checks=True)
        secure_client.force_login(self.alice)
        for url in [reverse("grades:subject_create"), reverse("grades:import_csv"), reverse("grades:delete_data"), reverse("grades:grade_delete", args=[self.grade.pk])]:
            self.assertEqual(secure_client.post(url, {}).status_code, 403)

    def test_user_text_is_escaped_in_html(self):
        self.mine.name = '<script>alert("x")</script>'
        self.mine.save()
        response = self.client.get(reverse("grades:subject_detail", args=[self.mine.pk]))
        self.assertContains(response, "&lt;script&gt;")
        self.assertNotContains(response, '<script>alert("x")</script>')


class CSVImportTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="importer")

    def upload(self, rows, header=COLUMNS):
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(header)
        writer.writerows(rows)
        return SimpleUploadedFile("grades.csv", output.getvalue().encode())

    def valid_row(self):
        return ["2026-2027", "Math", "Quiz", "8", "10", "1", "2026-10-12"]

    def test_import_is_owned_and_replay_skips_exact_duplicates(self):
        self.assertEqual(import_grades(self.upload([self.valid_row()]), self.user), (1, 0))
        self.assertEqual(import_grades(self.upload([self.valid_row()]), self.user), (0, 1))
        self.assertEqual(Assessment.objects.get().subject.owner_id, self.user.pk)
        self.assertEqual(Assessment.objects.get().source, "csv")

    def test_bad_last_row_rolls_back_entire_upload(self):
        broken = self.valid_row()
        broken[3] = "NaN"
        with self.assertRaises(ImportProblem):
            import_grades(self.upload([self.valid_row(), broken]), self.user)
        self.assertEqual(Subject.objects.count(), 0)
        self.assertEqual(Assessment.objects.count(), 0)

    def test_ownership_column_and_duplicate_headers_are_rejected(self):
        for header in [list(COLUMNS) + ["owner"], ["subject"] * 7]:
            with self.assertRaises(ImportProblem):
                import_grades(self.upload([self.valid_row()], header), self.user)

    def test_boundaries_and_invalid_formats(self):
        for column, value in [("earned", "Infinity"), ("possible", "0"), ("weight", "-1"), ("earned", "11"), ("year", "2026-2028"), ("date", "12/10/2026"), ("subject", "s" * 101)]:
            row = self.valid_row()
            row[COLUMNS.index(column)] = value
            with self.subTest(column=column, value=value), self.assertRaises(ImportProblem):
                import_grades(self.upload([row]), self.user)
        with self.assertRaises(ImportProblem):
            import_grades(self.upload([self.valid_row()] * 501), self.user)
        with self.assertRaises(ImportProblem):
            import_grades(SimpleUploadedFile("huge.csv", b"a" * 1_048_577), self.user)
        with self.assertRaises(ImportProblem):
            import_grades(SimpleUploadedFile("wrong.csv", b"\xff\xfe\x00"), self.user)

    def test_export_formula_values_are_neutralized(self):
        for title in ["=SUM(1,2)", "+1+1", "-1+1", "@SUM(1,2)", "  =1+1", "\t=1+1", "\ufeff=1+1"]:
            self.assertTrue(spreadsheet_safe(title).startswith("'"))
        self.assertEqual(spreadsheet_safe("Normal title"), "Normal title")

    @override_settings(DEBUG=False, ALLOW_DEMO_LOGIN=False)
    def test_demo_seed_is_blocked_in_production(self):
        with self.assertRaises(CommandError):
            call_command("seed_demo", stdout=io.StringIO())
