# Question Content Rendering

**Date:** 2026-09-04

The web application should render exam questions from the stable SyllabAI Question/QuestionPart API. It must not depend directly on parser repository paths or local OCR filesystem structure.

## Source representation

The project has GLM-OCR Markdown versions of past papers and mark schemes, with extracted images retained alongside the Markdown. These can provide the source-faithful presentation representation for question content.

```text
Question API
   ├── question metadata
   ├── question/part content
   ├── Markdown-derived renderable content
   └── stable visual asset references
                 ↓
             Next.js renderer
```

The renderer must be capable of presenting:

- normal text;
- equations/mathematics;
- tables;
- diagrams and graphs;
- chemical structures and apparatus images;
- multi-part questions;
- mark allocations;
- exam-paper instructions where relevant.

## Canonical references

Feature-specific records must reference Question/QuestionVersion/QuestionPart IDs instead of copying Markdown or image binaries.

This applies to:

- Exam Questions;
- Target Test;
- Test Builder;
- Mock Exams;
- notes with embedded past-paper questions;
- future question sets and adaptive practice.

For example:

```text
Test
 ├── QuestionVersionRef → Q001
 ├── QuestionVersionRef → Q037
 └── QuestionVersionRef → Q142
```

and:

```text
Note
 ├── authored content
 ├── QuestionEmbed → Q001
 └── QuestionEmbed → Q087
```

## Rendering and storage boundary

The browser should receive stable URLs/content references resolved by `syllabai-core`. It must never need to know whether the underlying asset is currently stored in the parser workspace, Cloudflare R2, or another object store.

Large source PDFs and image assets are infrastructure data and should not be committed into the Next.js repository merely to make them renderable.

## Feature expectations

### Exam Questions

Provide a faithful question presentation with filtering/search metadata such as subject, qualification, paper, session, topic, marks and completion state when available.

### Target Test

Render selected canonical questions while preserving their links to learner state, misconceptions, diagnosis and Smart Mark.

### Test Builder

Render selected questions without duplicating their content. The saved test contains question references and assessment configuration.

### Mock Exams

Support real-paper reproduction and constructed mock compositions as distinct assessment artifact types.

### Notes

Allow a note to embed a canonical past-paper question. The embed can expose navigation/actions such as open question, practice, add to test, or ask tutor, subject to permissions and product rules.

## Visual-first principle

Do not reduce an exam question to plain OCR text when a visual asset carries semantic information. The renderer should preserve the original question's visual evidence whenever available.
