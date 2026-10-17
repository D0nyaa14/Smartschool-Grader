from decimal import Decimal
from django import forms
from django.forms import formset_factory
from .models import Assessment, Subject


class SubjectForm(forms.ModelForm):
    class Meta:
        model = Subject
        fields = ["name", "year"]
        labels = {"year": "School year"}
        widgets = {"name": forms.TextInput(attrs={"placeholder": "e.g. Mathematics"}), "year": forms.TextInput(attrs={"placeholder": "2026-2027"})}


class GradeForm(forms.ModelForm):
    class Meta:
        model = Assessment
        fields = ["title", "earned", "possible", "weight", "date"]
        labels = {"earned": "Points earned", "possible": "Maximum points"}
        widgets = {"date": forms.DateInput(attrs={"type": "date"})}
        help_texts = {"weight": "Relative assessment weight. Use maximum points here for points-based averaging."}


class ImportForm(forms.Form):
    file = forms.FileField(label="CSV file", widget=forms.ClearableFileInput(attrs={"accept": ".csv,text/csv"}))


class TargetForm(forms.Form):
    target_percentage = forms.DecimalField(label="Target average (%)", min_value=0, max_value=100, max_digits=7, decimal_places=4, initial=70)


class FutureForm(forms.Form):
    earned = forms.DecimalField(label="Expected points", min_value=0, max_value=Decimal("999999"), max_digits=10, decimal_places=4)
    possible = forms.DecimalField(label="Maximum points", min_value=Decimal("0.0001"), max_value=Decimal("999999"), max_digits=10, decimal_places=4)
    weight = forms.DecimalField(label="Weight", min_value=Decimal("0.0001"), max_value=Decimal("999999"), max_digits=10, decimal_places=4)

    def clean(self):
        data = super().clean()
        if data.get("earned") is not None and data.get("possible") is not None and data["earned"] > data["possible"]:
            self.add_error("earned", "Expected points cannot exceed maximum points.")
        return data


FutureFormSet = formset_factory(FutureForm, extra=3, max_num=3, validate_max=True, absolute_max=3)
