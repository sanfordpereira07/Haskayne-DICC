/* Constellation prototype: app logic.
 *
 * One shared state object feeds both perspectives. The candidate's display name is
 * stored apart from the candidate id, and applications only hold the id, so a rename
 * shows up everywhere (header, preview, confirmation, queue, panel) with no duplicate
 * record and no status change. Everything is fictional and runs in the browser. */
(function () {
  'use strict';

  const D = window.CData;
  const Scoring = window.CScoring;
  const { ROLE, RUBRIC, CATEGORIES, EXPERIENCES, SAMPLE_ATTACHMENT, DEFAULT_PROFILE, SEED_CANDIDATES, SEED_APPLICATIONS } = D;

  const STORE_KEY = 'constellation.demo.v1';
  const NAME_MAX = 40;
  const EXP = Object.fromEntries(EXPERIENCES.map((e) => [e.id, e]));
  const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  const SKILL = Object.fromEntries(ROLE.skills.map((s) => [s.id, s]));
  const STATUS_LABEL = { new: 'New', review: 'In review', shortlisted: 'Shortlisted' };
  const MAYA_COLORS = ['#4f7df0', '#8a63f2'];

  /* ---------- small helpers ---------- */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const cvars = (c) => `--c:${c.color};--cg:${rgba(c.color, 0.6)};--cg2:${rgba(c.color, 0.22)}`;

  const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

  const isAlnum = (ch) => /[\p{L}\p{N}]/u.test(ch);
  function initials(name) {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    const letters = words.map((w) => Array.from(w).find(isAlnum)).filter(Boolean);
    if (!letters.length) return '?';
    if (letters.length === 1) {
      const w = words.find((x) => Array.from(x).some(isAlnum));
      return Array.from(w).filter(isAlnum).slice(0, 2).join('').toUpperCase();
    }
    return (letters[0] + letters[letters.length - 1]).toUpperCase();
  }

  const savedText = (expId, skillId) => {
    const e = EXP[expId];
    return (e.stories && e.stories[skillId]) || e.summary;
  };
  const expsIn = (catId) => EXPERIENCES.filter((e) => e.cat === catId);

  /* ---------- shared state (persisted) ---------- */

  function freshState() {
    return {
      profile: { candidateId: DEFAULT_PROFILE.candidateId, displayName: DEFAULT_PROFILE.displayName },
      draft: { picks: {}, attachment: false }, // picks[skillId] = { expId, text }
      application: null, // the demo candidate's submitted application, if any
      seedStatus: {}, // status overrides for the fictional queue entries
    };
  }

  function load() {
    const s0 = freshState();
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return s0;
      const s = JSON.parse(raw);
      const name = cleanName(s && s.profile && s.profile.displayName);
      if (name) s0.profile.displayName = name;
      if (s.draft && s.draft.picks) {
        ROLE.skills.forEach((sk) => {
          const p = s.draft.picks[sk.id];
          if (p && EXP[p.expId] && typeof p.text === 'string') s0.draft.picks[sk.id] = { expId: p.expId, text: p.text };
        });
        s0.draft.attachment = !!s.draft.attachment;
      }
      const a = s.application;
      if (
        a &&
        Array.isArray(a.answers) &&
        a.answers.length === ROLE.skills.length &&
        a.answers.every((x, i) => x && x.skillId === ROLE.skills[i].id && typeof x.text === 'string' && EXP[x.experienceId])
      ) {
        s0.application = {
          id: String(a.id || 'app-demo'),
          candidateId: s0.profile.candidateId,
          roleId: ROLE.id,
          status: STATUS_LABEL[a.status] ? a.status : 'new',
          submittedAt: Number(a.submittedAt) || Date.now(),
          answers: a.answers.map((x) => ({
            skillId: x.skillId,
            experienceId: x.experienceId,
            experienceTitle: EXP[x.experienceId].title,
            savedText: savedText(x.experienceId, x.skillId),
            text: x.text,
            edited: x.text !== savedText(x.experienceId, x.skillId),
          })),
          attachment: a.attachment ? { ...SAMPLE_ATTACHMENT } : null,
        };
      }
      if (s.seedStatus && typeof s.seedStatus === 'object') {
        SEED_APPLICATIONS.forEach((sa) => {
          if (STATUS_LABEL[s.seedStatus[sa.id]]) s0.seedStatus[sa.id] = s.seedStatus[sa.id];
        });
      }
    } catch (e) {
      /* storage blocked or corrupt: fall back to a clean in-memory demo */
    }
    return s0;
  }

  let state = load();
  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* ignore: the demo still works in memory */
    }
  }

  /* ---------- UI state (not persisted) ---------- */

  const ui = {
    view: 'candidate', // 'candidate' | 'recruiter'
    screen: 'map', // candidate: 'map' | 'apply' | 'done'
    openCategory: null,
    editingName: false,
    nameDraft: '', // what is typed in the name field, until saved
    nameError: false,
    editingSkill: null,
    picker: null, // skill id while the experience picker is open
    selectedAppId: null,
    criteriaOpen: false,
  };

  /* ---------- derived data ---------- */

  function nameFor(candidateId) {
    if (candidateId === state.profile.candidateId) return state.profile.displayName;
    return (SEED_CANDIDATES[candidateId] && SEED_CANDIDATES[candidateId].name) || 'Unknown candidate';
  }
  function avatarColors(candidateId) {
    return (SEED_CANDIDATES[candidateId] && SEED_CANDIDATES[candidateId].colors) || MAYA_COLORS;
  }

  function evaluate(answer) {
    if (answer.canned) {
      const spans = answer.canned.marks
        .map((p) => {
          const i = answer.text.indexOf(p);
          return i < 0 ? null : { start: i, end: i + p.length, tier: 'key' };
        })
        .filter(Boolean);
      return { score: answer.canned.score, explanation: answer.canned.explanation, spans };
    }
    return Scoring.score(answer.skillId, answer.text);
  }

  function buildQueue() {
    const items = SEED_APPLICATIONS.map((a) => ({ ...a, seed: true, status: state.seedStatus[a.id] || a.status }));
    if (state.application) items.push({ ...state.application, seed: false });
    items.forEach((it) => {
      it.name = nameFor(it.candidateId);
      it.results = it.answers.map(evaluate);
      it.total = it.results.reduce((n, r) => n + r.score, 0);
    });
    // Highest match first; a new demo submission wins ties.
    items.sort((a, b) => b.total - a.total || (a.seed ? 1 : 0) - (b.seed ? 1 : 0));
    return items;
  }

  function submittedLabel(it) {
    if (it.seed) return it.submittedLabel;
    const mins = Math.floor((Date.now() - it.submittedAt) / 60000);
    if (mins < 2) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    return new Date(it.submittedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const draftReady = () => ROLE.skills.every((s) => state.draft.picks[s.id] && state.draft.picks[s.id].text.trim());
  const sharedCount = () => new Set(Object.values(state.draft.picks).map((p) => p.expId)).size;

  /* ---------- icons ---------- */

  const svg = (body, extra) =>
    `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra || ''}>${body}</svg>`;
  const ICON = {
    lock: svg('<rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    pencil: svg('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 7.5l3 3"/>'),
    clip: svg('<path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.8 1.8 0 0 1-2.5-2.5l7.7-7.7"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
    reset: svg('<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>'),
    chevron: svg('<path d="M6 9l6 6 6-6"/>'),
    telescope: svg('<path d="M3.5 11.4L17 5.2l1.8 3.9L5.3 15.3z"/><path d="M19 8.8l1.6-.7"/><path d="M10.4 13l-2.1 7M12.6 12l3 8"/>'),
    spark: `<svg class="ico logo" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fb4ff"/><stop offset="1" stop-color="#b79cff"/></linearGradient></defs><path d="M12 1.5l2.2 8.3 8.3 2.2-8.3 2.2L12 22.5l-2.2-8.3L1.5 12l8.3-2.2z" fill="url(#lg)"/></svg>`,
  };
  const starGlyph = (color) =>
    `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" style="color:${color}"><path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z" fill="currentColor"/></svg>`;

  /* ---------- templates: shared chrome ---------- */

  function topbar() {
    const pressed = (v) => (ui.view === v ? 'true' : 'false');
    return `
      <header class="topbar">
        <div class="brand">${ICON.spark}<span>Constellation</span><span class="pilot" title="Proposed rollout: Haskayne BComm co-op pilot at the University of Calgary. Not live.">Proposed pilot · Haskayne BComm co-op</span></div>
        <div class="switch" role="group" aria-label="Perspective">
          <button type="button" data-action="set-view" data-view="candidate" data-fk="sw-candidate" aria-pressed="${pressed('candidate')}">Candidate</button>
          <button type="button" data-action="set-view" data-view="recruiter" data-fk="sw-recruiter" aria-pressed="${pressed('recruiter')}">Recruiter</button>
        </div>
        <div class="topbar-r"><button type="button" class="reset" data-action="reset" data-fk="reset" title="Clear the application and shortlist. Keeps your display name.">${ICON.reset}Reset demo</button></div>
      </header>`;
  }

  const avatar = (name, colors, cls, id) =>
    `<span class="avatar ${cls || ''}" ${id ? `id="${id}"` : ''} style="--a:${colors[0]};--b:${colors[1]}" aria-hidden="true">${esc(initials(name))}</span>`;

  /* ---------- templates: candidate ---------- */

  function candidateHeader() {
    const name = state.profile.displayName;
    let who;
    if (ui.editingName) {
      who = `
        <form class="name-form" data-form="name" novalidate>
          <label class="sr" for="nameInput">Display name</label>
          <input id="nameInput" data-fk="name-input" type="text" maxlength="${NAME_MAX}" value="${esc(ui.nameDraft)}" autocomplete="off" spellcheck="false" ${ui.nameError ? 'aria-invalid="true" class="bad"' : ''} />
          <button type="submit" class="btn primary sm" data-fk="name-save">Save</button>
          <button type="button" class="btn sm" data-action="name-cancel">Cancel</button>
          ${ui.nameError ? '<span class="err" role="alert">Enter a name to save.</span>' : ''}
        </form>`;
    } else {
      who = `
        <div class="who-line">
          <h1 class="cname">${esc(name)}</h1>
          <button type="button" class="edit-name" data-action="edit-name" data-fk="edit-name">${ICON.pencil}Edit name</button>
        </div>
        <div class="csub">Co-op applicant</div>`;
    }
    const right =
      ui.screen === 'map'
        ? `<span class="pill">${ICON.lock}Only you can see this map</span>`
        : ui.screen === 'apply'
          ? `<button type="button" class="btn" data-action="back-map" data-fk="back">${ICON.back}Constellation</button>`
          : '';
    return `
      <div class="chead">
        ${avatar(ui.editingName ? ui.nameDraft.trim() || '?' : name, MAYA_COLORS, 'lg', 'hdrAvatar')}
        <div class="who">${who}</div>
        <div class="chead-r">${right}</div>
      </div>`;
  }

  function applyCard() {
    const sub = state.application;
    return `
      <section class="card apply-card">
        <div class="eyebrow">${sub ? 'Your application' : `Open role · Posted on ${ROLE.channel}`}</div>
        <h2 class="role-title">${esc(ROLE.title)} <span class="dot">·</span> ${esc(ROLE.employer)}</h2>
        ${
          sub
            ? `<p class="muted">${sub.status === 'shortlisted' ? 'Shortlisted for interview.' : 'Submitted. The employer sees only what you shared.'}</p>
               <button type="button" class="btn xl wide" data-action="continue" data-fk="continue">View submission</button>`
            : `<p class="muted">Share one saved experience for each skill.</p>
               <button type="button" class="btn primary xl wide" data-action="continue" data-fk="continue">Continue application${ICON.arrow}</button>`
        }
      </section>`;
  }

  function starHTML(c) {
    const n = expsIn(c.id).length;
    const open = ui.openCategory === c.id;
    return `
      <button type="button" class="star label-${c.label} ${open ? 'is-open' : ''}" style="left:${c.pos.x}%;top:${c.pos.y}%;${cvars(c)}"
        data-action="open-category" data-id="${c.id}" data-fk="star-${c.id}" aria-pressed="${open}" aria-label="${esc(c.name)}, ${n} experiences">
        <span class="ring"></span><span class="core"></span>
        <span class="slabel"><b>${esc(c.name)}</b><i>${n} experiences</i></span>
      </button>`;
  }

  function satsHTML() {
    const radii = [5, 5.8, 4.6];
    return CATEGORIES.map((c) => {
      const open = ui.openCategory === c.id;
      return expsIn(c.id)
        .map((e, i) => {
          const ang = c.fan[i % c.fan.length];
          const r = radii[i % radii.length];
          const rad = (ang * Math.PI) / 180;
          const dx = (r * Math.cos(rad)).toFixed(2);
          const dy = (r * Math.sin(rad)).toFixed(2);
          return `
            <span class="spoke ${open ? 'open' : ''}" style="left:${c.pos.x}%;top:${c.pos.y}%;width:${r}rem;transform:rotate(${ang}deg);${cvars(c)}"></span>
            <span class="sat ${open ? 'open' : ''}" style="left:calc(${c.pos.x}% + ${dx}rem);top:calc(${c.pos.y}% + ${dy}rem);${cvars(c)}" title="${esc(e.title)}"></span>`;
        })
        .join('');
    }).join('');
  }

  function categoryPanel() {
    const c = CAT[ui.openCategory];
    const list = expsIn(c.id);
    return `
      <section class="card cat-panel" style="${cvars(c)}" aria-label="${esc(c.name)}">
        <header class="cat-head">
          ${starGlyph(c.color)}
          <div><h2>${esc(c.name)}</h2><span class="muted">${list.length} saved experiences</span></div>
          <button type="button" class="x" data-action="close-category" aria-label="Close ${esc(c.name)}">${ICON.close}</button>
        </header>
        <ul class="entries">
          ${list
            .map(
              (e) => `
            <li class="entry">
              ${starGlyph(c.color)}
              <div><b>${esc(e.title)}</b><p>${esc(e.summary)}</p></div>
            </li>`
            )
            .join('')}
        </ul>
      </section>`;
  }

  function mapSummary() {
    return `
      <section class="card summary">
        <div class="sum-top">
          <div class="big">${EXPERIENCES.length}</div>
          <div><b>saved experiences</b><p class="muted">Private and reusable across applications.</p></div>
        </div>
        <ul class="sum-list">
          ${CATEGORIES.map(
            (c) => `
            <li><button type="button" class="sum-row" style="${cvars(c)}" data-action="open-category" data-id="${c.id}">
              ${starGlyph(c.color)}<span>${esc(c.name)}</span><i>${expsIn(c.id).length}</i>
            </button></li>`
          ).join('')}
        </ul>
        <p class="sum-hint">Select a star to open it.</p>
      </section>`;
  }

  function mapScreen() {
    const lines = CATEGORIES.slice(0, -1)
      .map((c, i) => {
        const n = CATEGORIES[i + 1];
        return `<line x1="${c.pos.x}" y1="${c.pos.y}" x2="${n.pos.x}" y2="${n.pos.y}"/>`;
      })
      .join('');
    return `
      <div class="const">
        <section class="stage ${ui.openCategory ? 'has-open' : ''}" aria-label="Your constellation">
          <svg class="lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>
          ${satsHTML()}
          ${CATEGORIES.map(starHTML).join('')}
        </section>
        <aside class="side">
          ${ui.openCategory ? categoryPanel() : mapSummary()}
          ${applyCard()}
        </aside>
      </div>`;
  }

  /* Apply screen */

  function skillCard(sk, i) {
    const pick = state.draft.picks[sk.id];
    let body;
    if (!pick) {
      body = `<button type="button" class="choose" data-action="open-picker" data-skill="${sk.id}" data-fk="choose-${sk.id}">${ICON.plus}Choose an experience</button>`;
    } else {
      const exp = EXP[pick.expId];
      const cat = CAT[exp.cat];
      const edited = pick.text.trim() !== savedText(pick.expId, sk.id);
      const editing = ui.editingSkill === sk.id;
      body = `
        <div class="picked-top">
          <span class="chip" style="${cvars(cat)}"><i class="cdot"></i>${esc(exp.title)}</span>
          <button type="button" class="link" data-action="open-picker" data-skill="${sk.id}" data-fk="change-${sk.id}">Change</button>
        </div>
        ${
          editing
            ? `<textarea class="tailor-box" data-skill="${sk.id}" data-fk="ta-${sk.id}" rows="3" aria-label="Tailor your ${esc(sk.name)} example">${esc(pick.text)}</textarea>
               <div class="picked-actions">
                 <button type="button" class="btn sm primary" data-action="tailor-done" data-fk="done-${sk.id}">Done</button>
                 <button type="button" class="btn sm" data-action="tailor-restore" data-skill="${sk.id}">Restore saved wording</button>
                 <span class="note">This application only. Your saved experience is unchanged.</span>
               </div>`
            : `<blockquote class="quote">“${esc(pick.text.trim())}”</blockquote>
               <div class="picked-actions">
                 <button type="button" class="btn sm" data-action="tailor" data-skill="${sk.id}" data-fk="tailor-${sk.id}">${ICON.pencil}Tailor for this role</button>
                 <span class="note" data-edited-for="${sk.id}">${edited ? 'Edited for this role' : 'Saved wording'}</span>
               </div>`
        }`;
    }
    return `
      <section class="card skill">
        <div class="skill-info">
          <span class="num">${i + 1}</span>
          <h3>${esc(sk.name)}</h3>
          <p class="def">${esc(sk.definition)}</p>
        </div>
        <div class="skill-body">${body}</div>
      </section>`;
  }

  function attachRow() {
    const on = state.draft.attachment;
    return `
      <section class="card attach">
        <span class="attach-ico">${ICON.clip}</span>
        <div class="attach-txt"><b>Optional supporting material</b><span class="muted">Context only. It earns no points.</span></div>
        ${
          on
            ? `<span class="file">${ICON.clip}${esc(SAMPLE_ATTACHMENT.name)} <i>${esc(SAMPLE_ATTACHMENT.size)}</i></span>
               <button type="button" class="link" data-action="detach" data-fk="detach">Remove</button>`
            : `<button type="button" class="btn" data-action="attach" data-fk="attach">${ICON.plus}Attach sample file</button>`
        }
      </section>`;
  }

  function previewHTML() {
    const name = state.profile.displayName;
    const ready = draftReady();
    const others = EXPERIENCES.length - sharedCount();
    const items = ROLE.skills
      .map((sk) => {
        const p = state.draft.picks[sk.id];
        const has = p && p.text.trim();
        return `
          <div class="pv-item">
            <div class="eyebrow">${esc(sk.name)}${has ? ` <span class="from">· ${esc(EXP[p.expId].title)}</span>` : ''}</div>
            ${has ? `<p>“${esc(p.text.trim())}”</p>` : '<p class="empty">Not chosen yet</p>'}
          </div>`;
      })
      .join('');
    return `
      <div class="pv-head eyebrow">What the employer will see</div>
      <div class="pv-id">
        ${avatar(name, MAYA_COLORS, 'md')}
        <div><b>${esc(name)}</b><span class="muted">${esc(ROLE.title)} · ${esc(ROLE.employer)}</span></div>
      </div>
      ${items}
      <div class="pv-item pv-file">
        <div class="eyebrow">Supporting material</div>
        <p class="${state.draft.attachment ? '' : 'empty'}">${state.draft.attachment ? `${ICON.clip}${esc(SAMPLE_ATTACHMENT.name)}` : 'None attached'}</p>
      </div>
      <div class="privacy">${ICON.lock}<span>Your other ${others} experiences stay private.</span></div>
      <div class="pv-submit">
        <button type="button" class="btn primary xl wide" data-action="submit" data-fk="submit" ${ready ? '' : 'disabled'}>Submit application</button>
        ${ready ? '' : '<span class="muted hint">Choose an example for both skills.</span>'}
      </div>`;
  }

  function applyScreen() {
    return `
      <div class="apply">
        <div class="apply-main">
          <div class="apply-title">
            <div class="eyebrow">Applying to</div>
            <h2 class="role-title">${esc(ROLE.title)} <span class="dot">·</span> ${esc(ROLE.employer)}</h2>
          </div>
          ${ROLE.skills.map(skillCard).join('')}
          ${attachRow()}
        </div>
        <aside class="card preview" id="preview" aria-label="Application preview">${previewHTML()}</aside>
      </div>`;
  }

  function doneScreen() {
    const a = state.application;
    const name = state.profile.displayName;
    if (!a) return mapScreen();
    const shared = new Set(a.answers.map((x) => x.experienceId)).size;
    return `
      <div class="done">
        <section class="card done-card">
          <div class="done-star">${ICON.check}</div>
          <h2>Application submitted</h2>
          <p class="done-who"><b>${esc(name)}</b> · ${esc(ROLE.title)} · ${esc(ROLE.employer)}</p>
          <ul class="facts">
            <li><b>${a.answers.length}</b> examples shared</li>
            <li><b>${a.attachment ? 1 : 0}</b> supporting file${a.attachment ? '' : 's'}</li>
            <li><b>${EXPERIENCES.length - shared}</b> experiences stay private</li>
          </ul>
          <div class="status-line">Status <span class="status ${a.status}">${a.status === 'shortlisted' ? 'Shortlisted for interview' : 'Submitted'}</span></div>
          <button type="button" class="btn xl" data-action="back-map" data-fk="back">${ICON.back}Back to constellation</button>
        </section>
      </div>`;
  }

  function pickerModal() {
    const sk = SKILL[ui.picker];
    const current = state.draft.picks[sk.id];
    const groups = CATEGORIES.map(
      (c) => `
        <section class="pick-group" style="${cvars(c)}">
          <h4>${starGlyph(c.color)}${esc(c.name)}</h4>
          ${expsIn(c.id)
            .map(
              (e) => `
            <button type="button" class="pick ${current && current.expId === e.id ? 'is-current' : ''}" data-action="pick-exp" data-id="${e.id}" data-fk="pick-${e.id}">
              <b>${esc(e.title)}</b><span>${esc(e.summary)}</span>
              ${current && current.expId === e.id ? ICON.check : ''}
            </button>`
            )
            .join('')}
        </section>`
    ).join('');
    return `
      <div class="scrim" data-action="close-picker" data-self="1">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pickTitle">
          <header class="modal-head">
            <div><div class="eyebrow">Choose an experience</div><h2 id="pickTitle">${esc(sk.name)}</h2><p class="muted">${esc(sk.definition)}</p></div>
            <button type="button" class="x" data-action="close-picker" aria-label="Close">${ICON.close}</button>
          </header>
          <div class="pick-grid">${groups}</div>
          <footer class="modal-foot muted">${ICON.lock}Only the one you pick is shared.</footer>
        </div>
      </div>`;
  }

  function candidateView() {
    const screen = ui.screen === 'done' && !state.application ? 'map' : ui.screen;
    const body = screen === 'apply' ? applyScreen() : screen === 'done' ? doneScreen() : mapScreen();
    return `<div class="cand">${candidateHeader()}<div class="cand-body">${body}</div></div>`;
  }

  /* ---------- templates: recruiter (Telescope) ---------- */

  const pips = (n) => `<span class="pips" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

  function markup(text, spans) {
    let out = '';
    let i = 0;
    spans
      .slice()
      .sort((a, b) => a.start - b.start)
      .forEach((sp) => {
        out += esc(text.slice(i, sp.start));
        out += `<mark class="${sp.tier}">${esc(text.slice(sp.start, sp.end))}</mark>`;
        i = sp.end;
      });
    return out + esc(text.slice(i));
  }

  function criteriaPanel() {
    return `
      <section class="card criteria">
        <div class="crit-skills">
          ${ROLE.skills.map((sk) => `<div><h4>${esc(sk.name)}</h4><p>${esc(sk.definition)}</p></div>`).join('')}
        </div>
        <div class="scale" aria-label="Scoring rubric">
          ${RUBRIC.map((r) => `<div class="s${r.score}"><b>${r.score}</b><span>${esc(r.text)}</span></div>`).join('')}
        </div>
        <p class="scale-note">Grammar, polish, and attachments earn no points.</p>
      </section>`;
  }

  function queueRow(it) {
    const sel = ui.selectedAppId === it.id;
    const fresh = !it.seed && it.status === 'new';
    return `
      <button type="button" class="qrow ${sel ? 'sel' : ''} ${fresh ? 'fresh' : ''}" data-action="open-app" data-id="${it.id}" data-fk="row-${it.id}" aria-pressed="${sel}">
        <span class="who2">
          ${avatar(it.name, avatarColors(it.candidateId), 'md')}
          <span class="who2-t"><b>${esc(it.name)}</b><small>${esc(submittedLabel(it))}</small></span>
        </span>
        ${it.results.map((r) => `<span class="sc s${r.score}"><b>${r.score}</b>${pips(r.score)}</span>`).join('')}
        <span class="status ${it.status}">${STATUS_LABEL[it.status]}</span>
      </button>`;
  }

  function detailPanel(it) {
    const shortlisted = it.status === 'shortlisted';
    const skills = ROLE.skills
      .map((sk, i) => {
        const ans = it.answers[i];
        const res = it.results[i];
        return `
          <section class="sk">
            <div class="sk-top">
              <div><h4>${esc(sk.name)}</h4><span class="sk-exp">From ${esc(ans.experienceTitle)}</span></div>
              <div class="score s${res.score}" aria-label="Score ${res.score} out of 3"><b>${res.score}</b><span>/3</span>${pips(res.score)}</div>
            </div>
            <blockquote class="excerpt">“${markup(ans.text, res.spans)}”</blockquote>
            <p class="why"><span class="why-l">Why</span>${esc(res.explanation)}</p>
          </section>`;
      })
      .join('');
    return `
      <div class="panel-inner">
        <header class="panel-head">
          ${avatar(it.name, avatarColors(it.candidateId), 'md')}
          <div class="ph-t">
            <h2>${esc(it.name)}</h2>
            <span class="muted">${esc(ROLE.title)} · ${esc(submittedLabel(it))}</span>
          </div>
          <span class="status ${it.status}">${STATUS_LABEL[it.status]}</span>
          <button type="button" class="x" data-action="close-app" aria-label="Close panel">${ICON.close}</button>
        </header>
        <div class="panel-body">
          <div class="sec-title"><h3>Skill match</h3><span class="tag sim">Simulated demo data</span></div>
          ${skills}
          <section class="sk support">
            <div class="sk-top">
              <h4>Supporting material</h4>
              <span class="tag">Not scored</span>
            </div>
            <p class="file-line">${it.attachment ? `${ICON.clip}<b>${esc(it.attachment.name)}</b><span class="ok">Attached</span>` : '<span class="muted">None attached</span>'}</p>
          </section>
        </div>
        <footer class="panel-foot">
          <p class="note">3 = a concrete action that directly addresses the criterion. Scores rate the response and do not verify the event.</p>
          ${
            shortlisted
              ? `<div class="decided">${ICON.check}<span>Shortlisted for interview</span><button type="button" class="link" data-action="unshortlist" data-id="${it.id}" data-fk="unshortlist">Undo</button></div>`
              : `<button type="button" class="btn primary xl wide" data-action="shortlist" data-id="${it.id}" data-fk="shortlist">Shortlist for interview</button>`
          }
        </footer>
      </div>`;
  }

  function recruiterView() {
    const items = buildQueue();
    const sel = items.find((i) => i.id === ui.selectedAppId);
    return `
      <div class="rec">
        <main class="rec-main">
          <header class="role-head">
            <div>
              <div class="eyebrow">${ICON.telescope}Telescope · Recruiter workspace</div>
              <h1>${esc(ROLE.title)} <span class="dot">·</span> ${esc(ROLE.employer)}</h1>
              <div class="muted">Posted on ${ROLE.channel} · ${items.length} applicants</div>
            </div>
            <button type="button" class="btn ${ui.criteriaOpen ? 'is-on' : ''}" data-action="toggle-criteria" data-fk="criteria" aria-expanded="${ui.criteriaOpen}">Role criteria<span class="chev ${ui.criteriaOpen ? 'up' : ''}">${ICON.chevron}</span></button>
          </header>
          ${ui.criteriaOpen ? criteriaPanel() : ''}
          <section class="queue" aria-label="Review queue">
            <div class="queue-title"><h2>Review queue</h2><span class="tag">Sorted by match</span><span class="tag sim">Simulated demo data</span></div>
            <div class="qhead" aria-hidden="true">
              <span>Candidate</span>
              ${ROLE.skills.map((s) => `<span>${esc(s.short)}</span>`).join('')}
              <span>Status</span>
            </div>
            ${items.map(queueRow).join('')}
          </section>
        </main>
        <aside class="panel" aria-label="Applicant detail">
          ${
            sel
              ? detailPanel(sel)
              : `<div class="panel-empty"><div class="empty-star">${ICON.telescope}</div><p>Select an applicant to see the example behind each score.</p></div>`
          }
        </aside>
      </div>`;
  }

  /* ---------- render ---------- */

  function play(el, cls) {
    if (!el) return;
    const c = cls || 'fx-in';
    el.classList.remove(c);
    void el.offsetWidth;
    el.classList.add(c);
  }

  function render(fx) {
    const active = document.activeElement;
    const fk = active && active.dataset ? active.dataset.fk : null;
    document.body.dataset.view = ui.view;
    $('#app').innerHTML =
      topbar() + `<main class="view" id="view">${ui.view === 'candidate' ? candidateView() : recruiterView()}</main>` + (ui.picker ? pickerModal() : '');
    if (fk) {
      const next = document.querySelector(`[data-fk="${fk}"]`);
      if (next) next.focus({ preventScroll: true });
    }
    if (fx === 'screen') play($('#view'));
    if (fx === 'modal') play($('.modal'));
    if (fx === 'panel') {
      play($('.panel-inner'));
      play($('.cat-panel'));
    }
    if (fx === 'bloom') {
      document.querySelectorAll('.sat.open, .spoke.open').forEach((el) => play(el, 'fx-bloom'));
      play($('.cat-panel'));
    }
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ---------- actions ---------- */

  function focusEl(sel, end) {
    const el = $(sel);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (end && el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length);
    else if (el.select) el.select();
  }

  function setView(v) {
    if (ui.view === v) return;
    ui.view = v;
    ui.editingName = false;
    ui.nameError = false;
    ui.editingSkill = null;
    ui.picker = null;
    ui.selectedAppId = null;
    ui.criteriaOpen = false;
    render('screen');
  }

  function resetDemo() {
    const keep = state.profile.displayName;
    state = freshState();
    state.profile.displayName = keep;
    Object.assign(ui, {
      view: 'candidate',
      screen: 'map',
      openCategory: null,
      editingName: false,
      nameError: false,
      editingSkill: null,
      picker: null,
      selectedAppId: null,
      criteriaOpen: false,
    });
    save();
    render('screen');
    toast('Demo reset · display name kept');
  }

  function saveName(raw) {
    const name = cleanName(raw);
    ui.nameDraft = String(raw);
    if (!name) {
      ui.nameError = true;
      render();
      focusEl('#nameInput');
      return;
    }
    state.profile.displayName = name; // applications reference candidateId, so they follow automatically
    ui.editingName = false;
    ui.nameError = false;
    save();
    render();
    focusEl('[data-fk="edit-name"]');
    toast('Name saved');
  }

  function submitApplication() {
    if (!draftReady() || state.application) return;
    state.application = {
      id: `app-${Date.now().toString(36)}`,
      candidateId: state.profile.candidateId,
      roleId: ROLE.id,
      status: 'new',
      submittedAt: Date.now(),
      answers: ROLE.skills.map((sk) => {
        const p = state.draft.picks[sk.id];
        const saved = savedText(p.expId, sk.id);
        const text = p.text.trim();
        return {
          skillId: sk.id,
          experienceId: p.expId,
          experienceTitle: EXP[p.expId].title,
          savedText: saved,
          text,
          edited: text !== saved,
        };
      }),
      attachment: state.draft.attachment ? { ...SAMPLE_ATTACHMENT } : null,
    };
    ui.editingSkill = null;
    ui.screen = 'done';
    save();
    render('screen');
  }

  function setStatus(id, status) {
    if (state.application && state.application.id === id) state.application.status = status;
    else {
      const seed = SEED_APPLICATIONS.find((a) => a.id === id);
      if (!seed) return;
      if (status === seed.status) delete state.seedStatus[id];
      else state.seedStatus[id] = status;
    }
    save();
    render();
  }

  const actions = {
    'set-view': (el) => setView(el.dataset.view),
    reset: resetDemo,

    'edit-name': () => {
      ui.editingName = true;
      ui.nameDraft = state.profile.displayName;
      ui.nameError = false;
      render();
      focusEl('#nameInput');
    },
    'name-cancel': () => {
      ui.editingName = false;
      ui.nameError = false;
      render();
      focusEl('[data-fk="edit-name"]');
    },

    'open-category': (el) => {
      if (ui.openCategory === el.dataset.id) return;
      ui.openCategory = el.dataset.id;
      render('bloom');
    },
    'close-category': () => {
      ui.openCategory = null;
      render();
    },
    continue: () => {
      ui.screen = state.application ? 'done' : 'apply';
      render('screen');
    },
    'back-map': () => {
      ui.screen = 'map';
      ui.editingSkill = null;
      render('screen');
    },

    'open-picker': (el) => {
      ui.picker = el.dataset.skill;
      render('modal');
      const cur = state.draft.picks[ui.picker];
      focusEl(cur ? `[data-fk="pick-${cur.expId}"]` : '.pick');
    },
    'close-picker': (el, e) => {
      if (el.dataset.self && e.target !== el) return;
      const skill = ui.picker;
      ui.picker = null;
      render();
      focusEl(`[data-fk="${state.draft.picks[skill] ? 'change' : 'choose'}-${skill}"]`);
    },
    'pick-exp': (el) => {
      const skill = ui.picker;
      const cur = state.draft.picks[skill];
      if (!cur || cur.expId !== el.dataset.id) {
        state.draft.picks[skill] = { expId: el.dataset.id, text: savedText(el.dataset.id, skill) };
      }
      ui.picker = null;
      ui.editingSkill = null;
      save();
      render();
      focusEl(`[data-fk="tailor-${skill}"]`);
    },

    tailor: (el) => {
      ui.editingSkill = el.dataset.skill;
      render();
      focusEl(`[data-fk="ta-${el.dataset.skill}"]`, true);
    },
    'tailor-done': () => {
      const sk = ui.editingSkill;
      const p = state.draft.picks[sk];
      if (p && !p.text.trim()) p.text = savedText(p.expId, sk); // never leave an example blank
      ui.editingSkill = null;
      save();
      render();
      focusEl(`[data-fk="tailor-${sk}"]`);
    },
    'tailor-restore': (el) => {
      const sk = el.dataset.skill;
      const p = state.draft.picks[sk];
      p.text = savedText(p.expId, sk);
      save();
      render();
      focusEl(`[data-fk="ta-${sk}"]`, true);
    },

    attach: () => {
      state.draft.attachment = true;
      save();
      render();
    },
    detach: () => {
      state.draft.attachment = false;
      save();
      render();
      focusEl('[data-fk="attach"]');
    },
    submit: submitApplication,

    'toggle-criteria': () => {
      ui.criteriaOpen = !ui.criteriaOpen;
      render();
    },
    'open-app': (el) => {
      const first = ui.selectedAppId !== el.dataset.id;
      ui.selectedAppId = el.dataset.id;
      render(first ? 'panel' : undefined);
    },
    'close-app': () => {
      ui.selectedAppId = null;
      render();
    },
    shortlist: (el) => setStatus(el.dataset.id, 'shortlisted'),
    unshortlist: (el) => {
      const seed = SEED_APPLICATIONS.find((a) => a.id === el.dataset.id);
      setStatus(el.dataset.id, seed ? seed.status : 'new');
    },
  };

  /* ---------- events ---------- */

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el, e);
  });

  document.addEventListener('submit', (e) => {
    if (e.target.matches('[data-form="name"]')) {
      e.preventDefault();
      saveName($('#nameInput').value);
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'nameInput') {
      // Live initials while typing; nothing is saved until Save.
      ui.nameDraft = t.value;
      const av = $('#hdrAvatar');
      if (av) av.textContent = t.value.trim() ? initials(t.value) : '?';
      if (ui.nameError && t.value.trim()) {
        ui.nameError = false;
        t.classList.remove('bad');
        t.removeAttribute('aria-invalid');
        const err = $('.name-form .err');
        if (err) err.remove();
      }
    } else if (t.matches('textarea[data-skill]')) {
      const p = state.draft.picks[t.dataset.skill];
      if (!p) return;
      p.text = t.value;
      save();
      $('#preview').innerHTML = previewHTML(); // preview follows the edit live
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && ui.picker) {
      const f = Array.from(document.querySelectorAll('.modal button'));
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (e.key !== 'Escape') return;
    if (ui.picker) actions['close-picker']({ dataset: {} }, e);
    else if (ui.editingName) actions['name-cancel']();
    else if (ui.editingSkill) actions['tailor-done']();
    else if (ui.view === 'recruiter' && ui.selectedAppId) actions['close-app']();
    else if (ui.view === 'candidate' && ui.screen === 'map' && ui.openCategory) actions['close-category']();
  });

  /* ---------- star field (drawn once, static) ---------- */

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawSky() {
    const c = $('#sky');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rnd = mulberry32(11);
    const tints = ['255,255,255', '190,210,255', '205,190,255'];
    const n = Math.round((w * h) / 6500);
    for (let i = 0; i < n; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = 0.35 + Math.pow(rnd(), 4) * 1.3;
      const a = 0.12 + rnd() * 0.5;
      ctx.fillStyle = `rgba(${tints[Math.floor(rnd() * tints.length)]},${a.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 7; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
      g.addColorStop(0, 'rgba(200,215,255,.32)');
      g.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 9, y - 9, 18, 18);
    }
  }

  let skyTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(skyTimer);
    skyTimer = setTimeout(drawSky, 150);
  });

  drawSky();
  render();
})();
