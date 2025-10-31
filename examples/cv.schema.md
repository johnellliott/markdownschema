```defs
# Accepts: "March 2019 – Present", "March 2019 – June 2020", "2019 - 2020"
MONTH=/January|February|March|April|May|June|July|August|September|October|November|December/
YEAR=/\d{4}/
# Use the actual en dash character below between the quotes: –
EN_DASH=/–/
# Accept either hyphen-minus '-' or en dash '–'
DATE_RANGE=/(?:{{MONTH}}\s+{{YEAR}}\s*(?:-|{{EN_DASH}})\s*(?:Present|{{MONTH}}\s+{{YEAR}})|{{YEAR}}\s*(?:-|{{EN_DASH}})\s*{{YEAR}})/
ORG=/[A-Z][A-Za-z0-9 .&-]+/
ROLE=/[A-Za-z][A-Za-z0-9 .&/-]+/
DEGREE=/[A-Za-z0-9 .,&-]+/
UNIVERSITY=/[A-Za-z][A-Za-z0-9 .,&-]+/
```

# "John Smith"

## "Overview" { content: paragraphs(1..3) }

## "Skills" { content: list(>=1) }

## "Experience"
### /^{{ROLE}} at {{ORG}} \(\s*{{DATE_RANGE}}\s*\)$/i { minOccurs: 1, content: list(>=1) }

## "Education"
### /^{{DEGREE}}, {{UNIVERSITY}} \(\s*{{DATE_RANGE}}\s*\)$/ { minOccurs: 1 }
### *? { content: any }   <!-- allow optional extra subsections or notes -->

## "Certifications & Licenses" { content: list(>=1) }
