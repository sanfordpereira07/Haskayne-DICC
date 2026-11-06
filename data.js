/* Constellation prototype: fictional demo data.
 * Everything here is invented for the case-competition walkthrough. */
(function (g) {
  'use strict';

  const ROLE = {
    id: 'ops-coop',
    title: 'Operations Co-op',
    employer: 'Demo Employer',
    channel: 'Elevate',
    skills: [
      {
        id: 'adaptability',
        name: 'Adaptability',
        short: 'Adaptability',
        definition: 'Adjusts priorities or plans when resources or timelines change.',
      },
      {
        id: 'stakeholder',
        name: 'Stakeholder communication',
        short: 'Stakeholder comms',
        definition: 'Explains a change clearly and gives affected people a way to respond.',
      },
    ],
  };

  // Simple 0-3 rubric shown to the recruiter.
  const RUBRIC = [
    { score: 3, text: 'A concrete action that directly addresses the criterion' },
    { score: 2, text: 'A relevant action that only partly addresses it' },
    { score: 1, text: 'Mentioned, but no concrete action' },
    { score: 0, text: 'Not shown' },
  ];

  // Four category stars. `pos` is a percentage of the stage; `label` says where the
  // name sits; `fan` lists the angles (degrees, y down) where the small stars bloom.
  const CATEGORIES = [
    { id: 'professional', name: 'Professional Experience', color: '#7aa8ff', pos: { x: 15, y: 67 }, label: 'below', fan: [-100, -130, -160] },
    { id: 'extracurriculars', name: 'Extracurriculars', color: '#a98bff', pos: { x: 38, y: 27 }, label: 'above', fan: [60, 90, 120] },
    { id: 'hobbies', name: 'Hobbies & Interests', color: '#8ea2ff', pos: { x: 63, y: 68 }, label: 'below', fan: [-60, -90, -120] },
    { id: 'certifications', name: 'Certifications', color: '#76d6ff', pos: { x: 86, y: 31 }, label: 'above', fan: [20, 50, 80] },
  ];

  // Saved experiences. `summary` is the short saved description. `stories` holds
  // the saved wording for a specific skill; when absent, the summary is the default
  // wording. Candidates tailor a copy per application, so these are never edited.
  const EXPERIENCES = [
    { id: 'bookstore', cat: 'professional', title: 'Campus Bookstore Associate', summary: 'Handled textbook rush and returns at the campus store.' },
    { id: 'tutor', cat: 'professional', title: 'Peer Tutor, Intro Accounting', summary: 'Ran weekly small-group sessions for first-year students.' },
    { id: 'frontdesk', cat: 'professional', title: 'Rec Centre Front Desk', summary: 'Checked in members and answered questions at peak hours.' },

    {
      id: 'garden',
      cat: 'extracurriculars',
      title: 'Community Garden Volunteer Lead',
      summary: 'Led volunteers to keep a neighbourhood garden open.',
      stories: {
        adaptability:
          'When our main funder pulled out, I consolidated volunteer shifts around the busiest days so we could keep the garden open with fewer resources.',
      },
    },
    { id: 'casecomp', cat: 'extracurriculars', title: 'Business Case Club', summary: 'Built and pitched a case with a team of four.' },
    { id: 'volleyball', cat: 'extracurriculars', title: 'Intramural Volleyball Captain', summary: 'Organized weekly games for a ten-person team.' },

    {
      id: 'gaming',
      cat: 'hobbies',
      title: 'Gaming Community Organizer',
      summary: 'Ran online tournaments for a student gaming community.',
      stories: {
        stakeholder:
          'When we changed the tournament schedule, I posted a clear update, explained why it changed, and opened a thread for teams to flag conflicts.',
      },
    },
    { id: 'trail', cat: 'hobbies', title: 'Trail Running Group', summary: 'Plans weekend routes for a small run group.' },
    { id: 'film', cat: 'hobbies', title: 'Film Photography', summary: 'Develops and prints black-and-white rolls at home.' },

    { id: 'firstaid', cat: 'certifications', title: 'First Aid & CPR-C', summary: 'Valid through 2027.' },
    { id: 'excel', cat: 'certifications', title: 'Excel for Business', summary: 'Online course: lookups, pivot tables, dashboards.' },
    { id: 'whmis', cat: 'certifications', title: 'WHMIS Safety Training', summary: 'Workplace hazard awareness, completed.' },
  ];

  const SAMPLE_ATTACHMENT = { name: 'garden-shift-plan.pdf', size: '84 KB' };

  // The demo identity. The display name is stored apart from the candidate id,
  // so renaming never touches the id that applications point at.
  const DEFAULT_PROFILE = { candidateId: 'cand-maya', displayName: 'Maya Chen' };

  // Two fictional applicants that sit beside the demo candidate in the queue.
  // Their scores are fixed (`canned`) so the queue reads the same on every take.
  const SEED_CANDIDATES = {
    'cand-jordan': { name: 'Jordan Okafor', colors: ['#2f9fd8', '#5b7cf0'] },
    'cand-priya': { name: 'Priya Raman', colors: ['#7c5cf0', '#b283f2'] },
  };

  const SEED_APPLICATIONS = [
    {
      id: 'app-jordan',
      candidateId: 'cand-jordan',
      status: 'new',
      submittedLabel: 'Yesterday',
      attachment: null,
      answers: [
        {
          skillId: 'adaptability',
          experienceTitle: 'Group Project Lead',
          text: 'When a teammate dropped the course, I split their part between the rest of us and asked our instructor for two extra days.',
          canned: {
            score: 2,
            explanation: 'Reassigned work after losing a teammate, but not how the gap was closed.',
            marks: ['split their part between the rest of us'],
          },
        },
        {
          skillId: 'stakeholder',
          experienceTitle: 'Residence Floor Rep',
          text: 'I emailed the floor about the new quiet hours and asked for feedback at the next meeting.',
          canned: {
            score: 2,
            explanation: 'Shares the change and invites feedback, but does not explain why.',
            marks: ['emailed the floor about the new quiet hours', 'asked for feedback at the next meeting'],
          },
        },
      ],
    },
    {
      id: 'app-priya',
      candidateId: 'cand-priya',
      status: 'review',
      submittedLabel: '2 days ago',
      attachment: { name: 'club-newsletter.pdf', size: '212 KB' },
      answers: [
        {
          skillId: 'adaptability',
          experienceTitle: 'Student Club Treasurer',
          text: "I'm flexible and handle changing plans well.",
          canned: {
            score: 1,
            explanation: 'Claims flexibility; no concrete situation or action.',
            marks: [],
          },
        },
        {
          skillId: 'stakeholder',
          experienceTitle: 'Club Social Convenor',
          text: 'When the venue changed, I messaged every member with the new address and time.',
          canned: {
            score: 2,
            explanation: 'Shares the change clearly, but gives members no way to respond.',
            marks: ['messaged every member with the new address and time'],
          },
        },
      ],
    },
  ];

  const data = {
    ROLE,
    RUBRIC,
    CATEGORIES,
    EXPERIENCES,
    SAMPLE_ATTACHMENT,
    DEFAULT_PROFILE,
    SEED_CANDIDATES,
    SEED_APPLICATIONS,
  };

  g.CData = data;
  if (typeof module === 'object' && module.exports) module.exports = data;
})(typeof window !== 'undefined' ? window : globalThis);
