# PetroSpecial — بتروسبيشل

The official website of **PetroSpecial (بترو سبيشل لزيوت التشحيم)** — a Saudi manufacturer of motor oils and lubricants based in Jeddah. **SAUDI MADE**, aligned with Saudi Vision 2030.

**Live site:** [petrospecial.com](https://petrospecial.com)

## Highlights

- **Arabic-first, fully bilingual** — launches in Arabic (RTL) with a complete English version (LTR) via the in-header language toggle; choice persists across visits.
- **Light premium design** — "Liquid Engineering" design language: warm light surfaces, metallic gold accents, deep petro-blue, flowing viscosity-line motifs.
- **Complete catalog** — 3 brand families (Special · Petrotoryon · Raval), 23 SKUs, each with a full 7-block datasheet page.
- **Pure static** — hand-written HTML/CSS/vanilla JS, no frameworks, no build step; deployed on GitHub Pages.
- **Self-owned contact system** — the contact form stores messages in the company's own Supabase database with a private admin inbox; no third-party form service.

## Structure

```
index.html               Homepage
products/                Catalog (3 brand tabs → 23 SKU pages)
about/  quality/         Company story · certifications & QA
distribution/  contact/  Coverage & channels · contact + form
privacy/  404.html       Privacy policy · branded 404
admin/                   Private message inbox (owner only)
assets/css/styles.css    Single design-system stylesheet
assets/js/main.js        Single script: i18n, nav, motion, forms
```

© PetroSpecial. All rights reserved — حقوق النشر © بتروسبيشل
