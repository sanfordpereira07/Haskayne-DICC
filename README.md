# Constellation: interactive prototype

A clickable prototype of **Constellation**, an early-career hiring product, built for a case competition.
Candidates keep a private, reusable map of their experiences. Recruiters review applications in
**Telescope**.

Everything is fictional. There is no login, backend, or AI call. Scoring is simulated in the browser.
The Haskayne BComm co-op pilot is shown as *proposed*, and Elevate stays the posting channel.

## Run it

No build step and no dependencies. Either open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>. The layout is built for a 16:9 desktop window. All sizes scale with
the viewport, so a 1280×720 or 1920×1080 recording looks the same.

## Recording the walkthrough (about 100 seconds)

| Time | Perspective | What to click |
| --- | --- | --- |
| 0:00–0:15 | Candidate | Maya's constellation. Click **Extracurriculars** (Community Garden Volunteer Lead), then **Hobbies & Interests** (Gaming Community Organizer), then **Continue application**. |
| 0:15–0:55 | Candidate | **Choose an experience** under Adaptability and pick *Community Garden Volunteer Lead*. Optionally click **Tailor for this role**. Choose *Gaming Community Organizer* for Stakeholder communication. Click **Attach sample file** (optional). |
| 0:55–1:05 | Candidate | Point at **What the employer will see**, which shows the name, both examples, the attachment, and "other experiences stay private". Click **Submit application**. |
| 1:05–1:45 | Recruiter | Flip the **Candidate / Recruiter** switch. Open **Role criteria**, click the new row, and read the highlighted evidence behind each score. Click **Shortlist for interview**. End here. |

About 15 clicks, and no typing is needed.

### Before you record

- **Edit name** sits next to the name in the candidate header. It accepts any non-blank name (up to 40
  characters). **Enter** saves, **Esc** cancels. The saved name and its initials appear in the header,
  the preview, the confirmation, the recruiter queue, and the recruiter panel.
- **Reset demo** (top right, deliberately quiet) clears the application, the draft, and every shortlist
  status, and returns to the candidate's constellation. It **keeps your display name**.
- State lives in `localStorage`, so a reload mid-take keeps your place. Use Reset demo for a clean take.

## How the shared state works

- The display name is stored apart from the candidate ID (`cand-maya`). An application stores only the ID.
  Renaming the candidate updates every screen, including an application that already exists. It never
  creates a duplicate and never changes the status.
- **Submit application** writes a real record: the chosen experiences, the exact wording (including edits
  made with *Tailor for this role*), and the attachment choice. The recruiter view renders that record.
- Tailoring edits a per-application copy. The saved experience is never modified, and *Restore saved
  wording* undoes the edit.

## Simulated scoring

`scoring.js` stands in for Telescope's AI. It reads the submitted wording against the role's rubric and
returns a 0–3 score, a one-line reason, and the phrases that earned the score.

- **3** is a concrete action that directly addresses the criterion. **2** is a relevant action that only
  partly addresses it. **1** is mentioned, but with no concrete action. **0** is not shown.
- Grammar, polish, and attachments are never inputs. The supporting-material status is shown separately
  and marked *Not scored*.
- A score describes the response against the rubric. It does not verify that the event happened. The
  panel says so.
- The two seeded demo examples score 3 and 3. Light edits keep their score. A large rewrite that removes
  the evidence will score lower, and so will a mismatched pairing (for example, the tournament story
  under Adaptability). That is the rubric working as intended, but check it on a rehearsal take.
- The two other applicants, Jordan Okafor and Priya Raman, have fixed scores so the queue reads the same
  on every take.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell. |
| `styles.css` | Visual identity: near-black sky, blue and violet accents, calmer Telescope surfaces. |
| `data.js` | Role and skill definitions, categories, saved experiences, the two fictional applicants. |
| `scoring.js` | The simulated rubric scorer. |
| `app.js` | Shared state, rendering, and actions. |

To change the demo story, edit `data.js`. The skill definitions are in `ROLE.skills`, the saved
experiences are in `EXPERIENCES`, and the sample attachment is in `SAMPLE_ATTACHMENT`.
