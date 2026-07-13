# PDF operation checklist for the bundled skill

## Read or extract

Run `scripts/inspect_pdf.py input.pdf`. If the text preview is empty or incomplete, identify the
file as scanned and request/offer OCR rather than presenting extraction as complete.

## Modify pages

After a merge, split, or rotation, compare source and output page counts, then render the first,
last, and every changed page with `scripts/render_pdf.py`.

## Forms and sensitive files

List form field names and values only when the user is authorized to access them. Never log secrets,
identifiers, or full form contents in a command transcript.
