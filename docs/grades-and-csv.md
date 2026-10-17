# Grades, calculations, and CSV

In school mode, each saved grade belongs to one signed-in student and one academic year. A student's CSV import cannot choose another owner. Guest mode has separate browser-only records without an account. Subject averages are calculated separately for each year and subject; a subject with no grades has no average.

Signing in never transfers guest records automatically. Export/import a CSV deliberately if you want to move records between modes. Guest data is temporary by default; remember it only through the explicit browser-storage option, and avoid that option on shared devices.

## CSV format

Use a UTF-8 comma-separated file with this exact header:

```csv
year,subject,title,earned,possible,weight,date
2026-2027,Mathematics,Algebra quiz,16,20,1,2026-10-01
2026-2027,Mathematics,Term exam,72,100,3,2026-12-10
2026-2027,English,Essay,17.5,20,2,2026-10-08
```

| Column | Meaning |
| --- | --- |
| `year` | Academic year, such as `2026-2027`. |
| `subject` | Subject name. Use consistent spelling. |
| `title` | Assignment or exam name. |
| `earned` | Points earned, at least zero and no more than `possible`. |
| `possible` | Positive maximum points. |
| `weight` | Positive relative contribution of this assessment. |
| `date` | Assessment date in `YYYY-MM-DD` format. |

Use a dot for decimals, with at most four decimal places. If a title includes a comma, quote the field: `"Quiz, chapter 2"`. Do not add student IDs, passwords, access tokens, or extra columns. This importer is intended for each student's own records, not a class roster.

In school mode, imports are validated on the server before saving. An invalid upload is rejected with a useful error; correct the CSV and try again. Repeated identical rows are skipped and reported rather than counted twice. School uploads are limited to 500 records and 1 MiB. Guest CSV handling runs in the browser and saves into that guest workspace. Preview your file and keep an export before substantial changes.

Imported records are student-supplied and may differ from the official school transcript. An official connector would need to preserve provenance and define its correction and synchronization rules separately.

## Weighted averages

The app calculates:

```text
weighted sum = Σ ((earned ÷ possible) × weight)
average (%) = 100 × weighted sum ÷ Σ weight
```

A quiz worth `16/20`, weight `1`, and an exam worth `72/100`, weight `3` give:

```text
100 × ((16/20 × 1) + (72/100 × 3)) ÷ (1 + 3) = 74%
```

Use weight `1` for equally weighted assessments, regardless of point scales. For a points-based average, use each assessment's maximum points as its weight: `16/20` with weight `20` and `72/100` with weight `100` give `88/120 = 73.33%`.

Do not mix these methods unintentionally. A school's category weights, exam rules, resits, exemptions, extra credit, dropped grades, or official rounding rules require additional code. Decimal calculations are used on the server, and the display rounds percentages for readability.

## Future-score simulation

Select a subject and enter hypothetical future assessments using the same earned/possible/weight model. The simulator combines them with existing grades for that subject and year, then shows the estimated result. A prediction does not create or edit a saved assessment.

The result is a mathematical estimate. It is only as accurate as the selected grades and weights and does not guarantee an official school result.

## Export and deletion

Export downloads only the current student's saved grades. Treat exported files as private student records and save them outside your repository. The dashboard also provides a confirmation step to delete all of the signed-in student's subjects and grades. Their local sign-in identity remains, so they can return to an empty dashboard. Contact the operator for complete account removal. Hosting backups can retain earlier copies until their retention period ends; the operator must document that period.

Guest export downloads only the current browser's guest grades. **Clear all guest data** clears those records and the remembered browser copy after confirmation; it has no effect on a school account's records. Clearing school data likewise does not clear a separate guest workspace.

For spreadsheet safety, exports prefix formula-like subject/title text with an apostrophe. Review those cells if you later reimport an export; the protective apostrophe becomes part of the imported text.
