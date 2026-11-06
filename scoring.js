/* Constellation prototype: simulated scoring (no AI call, no network).
 *
 * This stands in for Telescope's AI. It reads the submitted wording against the
 * role's rubric and returns a 0-3 score, a one-line reason, and the character
 * ranges that earned the score. Grammar, polish, and attachments are never inputs.
 *
 *   3  concrete action that directly addresses the criterion
 *   2  relevant action that only partly addresses it
 *   1  mentioned, but no concrete action
 *   0  not shown
 */
(function (g) {
  'use strict';

  // Split text into clauses with absolute offsets. Boundaries are punctuation and
  // connector words, so "I did X so we could Y" becomes two clauses.
  function clauses(text) {
    const out = [];
    const segRe = /[^,;.!?\n]+/g;
    let m;
    while ((m = segRe.exec(text)) !== null) {
      const seg = m[0];
      const base = m.index;
      const starts = [0];
      const ends = [];
      const splitRe = /\s+(?=(?:and|so|because|but|which|while|then|since)\b)/gi;
      let s;
      while ((s = splitRe.exec(seg)) !== null) {
        ends.push(s.index);
        starts.push(s.index + s[0].length);
      }
      ends.push(seg.length);
      starts.forEach((from, i) => {
        let a = from;
        let b = ends[i];
        while (a < b && /\s/.test(seg[a])) a++;
        while (b > a && /\s/.test(seg[b - 1])) b--;
        // Drop a leading "and"/"but"/"then" so highlights start on the content.
        const lead = /^(?:and|but|then)\s+/i.exec(seg.slice(a, b));
        if (lead) a += lead[0].length;
        if (b > a) out.push({ start: base + a, end: base + b, text: text.slice(base + a, base + b) });
      });
    }
    return out;
  }

  function firstClause(cls, re) {
    return cls.find((c) => re.test(c.text)) || null;
  }

  function detect(text, signals) {
    const cls = clauses(text);
    const found = {};
    signals.forEach((sig) => {
      found[sig.id] = firstClause(cls, sig.re);
    });
    return found;
  }

  // Merge ranges; a "key" range beats a "soft" one that overlaps it.
  function toSpans(found, signals) {
    const spans = [];
    signals.forEach((sig) => {
      const c = found[sig.id];
      if (c) spans.push({ start: c.start, end: c.end, tier: sig.tier });
    });
    spans.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    spans.forEach((sp) => {
      const last = merged[merged.length - 1];
      if (last && sp.start < last.end) {
        if (sp.tier === 'key') last.tier = 'key';
        last.end = Math.max(last.end, sp.end);
      } else {
        merged.push({ ...sp });
      }
    });
    return merged;
  }

  const RULES = {
    adaptability: {
      signals: [
        {
          id: 'change',
          tier: 'key',
          re: /\b(pulled\s+out|pulled\s+funding|cuts?|lost|loss|ran\s+out|dropped|quit|cancell?ed|delay\w*|postpone\w*|moved\s+up|shortened|reduced|short-?staffed|unexpected|last-?minute|changed|no\s+longer|withdrew|fell\s+through|funder|funding|budget|deadline|shortage|late)\b/i,
        },
        {
          id: 'action',
          tier: 'key',
          re: /\b(consolidat\w*|reschedul\w*|reprioriti[sz]\w*|re-?organi[sz]\w*|shifted|re-?plan\w*|adjust\w*|restructur\w*|re-?sequenc\w*|combin\w*|merg\w*|swap\w*|rearrang\w*|trimm\w*|narrow\w*|focus\w*|split|redistribut\w*|reassign\w*|pivot\w*|moved|re-?alloc\w*|re-?work\w*)\b/i,
        },
        {
          id: 'outcome',
          tier: 'soft',
          re: /\b(so|keep|kept|stay\w*|on\s+time|on\s+track|met|without|with\s+(?:fewer|less|limited|only)|despite|ensur\w*|allow\w*|avoid\w*)\b/i,
        },
      ],
      generic: /\b(flexib\w*|adaptab\w*|adapt\w*)\b/i,
      rate(f, generic) {
        if (f.change && f.action && f.outcome) return 3;
        if (f.change && f.action) return 2;
        if (f.change || f.action) return 1;
        return generic ? 1 : 0;
      },
      explain(score, f, generic) {
        if (score === 3) {
          const funding = /fund|sponsor|grant|budget/i.test(f.change.text);
          const schedule = /shift|schedul|rota|calendar|plan/i.test(f.action.text);
          if (funding && schedule) return 'Changed the schedule after losing funding, and kept the work going with fewer resources.';
          return 'Changed the plan when conditions shifted, and shows how it worked within the constraint.';
        }
        if (score === 2) return 'Changes the plan after a setback, but does not show how it worked within the constraint.';
        if (f.change) return 'Names a change, but no concrete adjustment is described.';
        if (f.action) return 'Describes an action, but not the change that prompted it.';
        if (generic) return 'Claims flexibility; no concrete situation or action.';
        return 'No example of adjusting a plan is shown.';
      },
    },

    stakeholder: {
      signals: [
        {
          id: 'inform',
          tier: 'key',
          re: /\b(post(?:ed)?|announc\w*|sent|emailed|messag\w*|told|tell|shar\w*|explain\w*|updat\w*|notif\w*|inform\w*|brief\w*|wrote|walked|presented|briefed)\b/i,
        },
        { id: 'reason', tier: 'key', re: /\b(why|because|reason\w*|rationale|context)\b/i },
        {
          id: 'respond',
          tier: 'key',
          re: /(?:\b(thread|repl(?:y|ies|ied)|flag\w*|feedback|questions?|respond\w*|response|concerns?|let\s+(?:me|us|them)\s+know|office\s+hours|comments?|ask(?:ed|ing)?|conflicts?|input|poll|raise\w*)\b|q&a)/i,
        },
      ],
      generic: /\b(communicat\w*|clear|listen\w*)\b/i,
      rate(f, generic) {
        const n = ['inform', 'reason', 'respond'].filter((k) => f[k]).length;
        if (n === 3) return 3;
        if (n === 2) return 2;
        if (n === 1) return 1;
        return generic ? 1 : 0;
      },
      explain(score, f, generic) {
        if (score === 3) return 'Shared the change, gave the reason, and opened a way for affected people to respond.';
        if (score === 2) {
          if (!f.respond) return 'Shares the change and why, but gives no way to respond.';
          if (!f.reason) return 'Shares the change and invites a response, but does not explain why.';
          return 'Explains and invites a response, but not how the change was shared.';
        }
        if (score === 1 && !generic) return 'Touches on communication, but no clear explanation or way to respond.';
        if (score === 1) return 'Claims good communication; no concrete change or response route.';
        return 'No example of communicating a change is shown.';
      },
    },
  };

  function score(skillId, rawText) {
    const rule = RULES[skillId];
    const text = String(rawText || '');
    if (!rule || text.trim().split(/\s+/).filter(Boolean).length < 3) {
      return { score: 0, explanation: 'No example is shown for this skill.', spans: [] };
    }
    const found = detect(text, rule.signals);
    const generic = rule.generic.test(text);
    const s = rule.rate(found, generic);
    return { score: s, explanation: rule.explain(s, found, generic), spans: toSpans(found, rule.signals) };
  }

  const api = { score, clauses };
  g.CScoring = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
