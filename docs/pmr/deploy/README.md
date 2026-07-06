# Lambenti PMR Survey — Deployment Pack

This folder contains deployable survey artifacts generated from `docs/pmr/lambenti-pmr-survey.md`.

## Recommended path: Google Forms

A. Open https://script.google.com/.
B. Create a new Apps Script project.
C. Paste `google-forms-lambenti-pmr.gs` into `Code.gs`.
D. Run `createLambentiPmrSurvey()`.
E. Approve permissions.
F. In Apps Script logs, open the generated `Edit URL`.
G. In Google Forms, click `Responses` → connect to a Google Sheet.
H. Review the form once, then send the published URL.

This route is closest to ready-to-deploy because it creates the actual Google Form with sections, required questions, scales, grids, checkbox questions, and the Q25 max-3 validation.

## Tally / Typeform path

Use `tally-typeform-paste-ready.md` as the clean respondent-facing source. Paste question-by-question into Tally or Typeform. Keep the same question IDs in labels so exports map back to the schema/codebook.

## Static HTML path

`lambenti-pmr-survey.html` is a self-contained survey preview/static artifact. It can be opened locally or hosted on any static host, but it currently downloads a JSON response instead of saving to a central database. Before public launch, connect the submit handler to a backend/form endpoint if you use this route.

## Analysis files

Use these parent-folder files after collecting responses:

A. `../lambenti-pmr-schema.csv`
B. `../lambenti-pmr-codebook.csv`
C. `../lambenti-pmr-respondent-scores-template.csv`

## Launch checks before sending publicly

A. Confirm currency: CAD for Canada or clone/convert to USD for US-only distribution.
B. Send a 3–5 person pilot and inspect exports.
C. Confirm Q23 concept wording is visible only after behavior questions.
D. Confirm Q25 enforces “select up to 3.”
E. Confirm responses export with Q IDs preserved.
