import { useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';

const DEFAULT_HEADINGS = {
  summary: 'PROFESSIONAL SUMMARY',
  technicalSkills: 'TECHNICAL SKILLS',
  experience: 'PROFESSIONAL EXPERIENCE',
  projects: 'PROJECTS',
  education: 'EDUCATION',
  certifications: 'CERTIFICATIONS',
  achievements: 'ACHIEVEMENTS',
};

const ALL_KEYS = ['summary', 'technicalSkills', 'experience', 'projects', 'education', 'certifications', 'achievements'];

export const EMPTY_PROFILE = {
  personalInfo: { fullName: '', location: '', phone: '', email: '', linkedin: '', github: '', other: [] },
  headline: '',
  summary: '',
  technicalSkills: [],
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  achievements: [],
  sectionOrder: [{ key: 'summary', heading: 'PROFESSIONAL SUMMARY' }],
};

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-brand-600 focus:outline-none';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';
const btnAddCls = 'inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50';

function splitLines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

function splitComma(text) {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

export default function ProfileEditor({ initialData, onSave, onCancel }) {
  const base = initialData ?? EMPTY_PROFILE;
  const [form, setForm] = useState(() => ({
    personalInfo: { ...EMPTY_PROFILE.personalInfo, ...(base.personalInfo ?? {}) },
    headline: base.headline ?? '',
    summary: base.summary ?? '',
    technicalSkills: (base.technicalSkills ?? []).map((g) => ({ category: g.category, itemsText: (g.items ?? []).join(', ') })),
    experience: (base.experience ?? []).map((e) => ({ ...e, bulletsText: (e.bullets ?? []).join('\n') })),
    projects: (base.projects ?? []).map((p) => ({ ...p, techText: (p.technologies ?? []).join(', '), bulletsText: (p.bullets ?? []).join('\n') })),
    education: (base.education ?? []).map((ed) => ({ ...ed })),
    certifications: (base.certifications ?? []).map((c) => ({ issuer: '', date: '', credentialId: '', ...c })),
    achievementsText: (base.achievements ?? []).join('\n'),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const setInfo = (key, val) => setForm((f) => ({ ...f, personalInfo: { ...f.personalInfo, [key]: val } }));

  const updateItem = (section, idx, patch) =>
    setForm((f) => ({ ...f, [section]: f[section].map((item, i) => (i === idx ? { ...item, ...patch } : item)) }));

  const removeItem = (section, idx) =>
    setForm((f) => ({ ...f, [section]: f[section].filter((_, i) => i !== idx) }));

  const addItem = (section, template) =>
    setForm((f) => ({ ...f, [section]: [...f[section], template] }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!form.personalInfo.fullName.trim()) {
      setError('Full name is required.');
      return;
    }

    const technicalSkills = form.technicalSkills
      .map((g) => ({ category: g.category.trim(), items: splitComma(g.itemsText) }))
      .filter((g) => g.category && g.items.length > 0);

    const experience = form.experience
      .filter((ex) => ex.company.trim())
      .map(({ bulletsText, ...rest }) => ({
        company: rest.company.trim(),
        location: (rest.location ?? '').trim(),
        title: (rest.title ?? '').trim(),
        startDate: (rest.startDate ?? '').trim(),
        endDate: (rest.endDate ?? '').trim(),
        bullets: splitLines(bulletsText),
      }));

    const projects = form.projects
      .filter((p) => p.name.trim())
      .map(({ techText, bulletsText, ...rest }) => ({
        name: rest.name.trim(),
        technologies: splitComma(techText),
        bullets: splitLines(bulletsText),
      }));

    const education = form.education
      .filter((ed) => ed.institution.trim())
      .map((ed) => ({
        institution: ed.institution.trim(),
        location: (ed.location ?? '').trim(),
        degree: (ed.degree ?? '').trim(),
        score: (ed.score ?? '').trim(),
        startDate: (ed.startDate ?? '').trim(),
        endDate: (ed.endDate ?? '').trim(),
      }));

    const certifications = form.certifications
      .filter((c) => c.name.trim())
      .map((c) => ({
        name: c.name.trim(),
        issuer: (c.issuer ?? '').trim(),
        date: (c.date ?? '').trim(),
        credentialId: (c.credentialId ?? '').trim(),
      }));

    const achievements = splitLines(form.achievementsText);

    const payload = {
      personalInfo: {
        fullName: form.personalInfo.fullName.trim(),
        location: form.personalInfo.location.trim(),
        phone: form.personalInfo.phone.trim(),
        email: form.personalInfo.email.trim(),
        linkedin: form.personalInfo.linkedin.trim(),
        github: form.personalInfo.github.trim(),
        other: form.personalInfo.other ?? [],
      },
      headline: form.headline.trim(),
      summary: form.summary.trim(),
      technicalSkills,
      experience,
      projects,
      education,
      ...(certifications.length ? { certifications } : {}),
      achievements,
      sectionOrder: [],
    };

    // Preserve previous order/headings for sections that still have content, then append new ones
    const existingOrder = (base.sectionOrder ?? []).filter((s) => {
      if (s.key === 'summary') return Boolean(payload.summary);
      return Array.isArray(payload[s.key]) && payload[s.key].length > 0;
    });
    const seen = new Set(existingOrder.map((s) => s.key));
    for (const key of ALL_KEYS) {
      if (seen.has(key)) continue;
      const has = key === 'summary' ? Boolean(payload.summary) : Array.isArray(payload[key]) && payload[key].length > 0;
      if (has) existingOrder.push({ key, heading: DEFAULT_HEADINGS[key] });
    }
    payload.sectionOrder = existingOrder.length ? existingOrder : [{ key: 'summary', heading: DEFAULT_HEADINGS.summary }];

    setSaving(true);
    try {
      await onSave(payload);
    } catch (err) {
      setError(err.message || 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      {/* Personal Info */}
      <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-brand-800">Personal Info &amp; Headline</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Full Name *</label>
            <input className={inputCls} value={form.personalInfo.fullName} onChange={(e) => setInfo('fullName', e.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>Headline</label>
            <input className={inputCls} placeholder="e.g. Full Stack Developer | React | Node.js" value={form.headline} onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input className={inputCls} value={form.personalInfo.email} onChange={(e) => setInfo('email', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input className={inputCls} value={form.personalInfo.phone} onChange={(e) => setInfo('phone', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Location</label>
            <input className={inputCls} value={form.personalInfo.location} onChange={(e) => setInfo('location', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>LinkedIn</label>
            <input className={inputCls} value={form.personalInfo.linkedin} onChange={(e) => setInfo('linkedin', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>GitHub</label>
            <input className={inputCls} value={form.personalInfo.github} onChange={(e) => setInfo('github', e.target.value)} />
          </div>
        </div>
      </fieldset>

      {/* Summary */}
      <fieldset className="space-y-2 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-brand-800">Professional Summary</legend>
        <textarea className={inputCls} rows={3} value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} />
      </fieldset>

      {/* Technical Skills */}
      <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <legend className="text-xs font-semibold uppercase tracking-wide text-brand-800">Technical Skills</legend>
          <button type="button" className={btnAddCls} onClick={() => addItem('technicalSkills', { category: '', itemsText: '' })}>
            <Plus className="h-3.5 w-3.5" /> Add skill group
          </button>
        </div>
        {form.technicalSkills.map((g, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3 sm:flex-row sm:items-end">
            <div className="sm:w-1/3">
              <label className={labelCls}>Category</label>
              <input className={inputCls} placeholder="e.g. Backend" value={g.category} onChange={(e) => updateItem('technicalSkills', i, { category: e.target.value })} />
            </div>
            <div className="flex-1">
              <label className={labelCls}>Skills (comma-separated)</label>
              <input className={inputCls} placeholder="Node.js, Express, MongoDB" value={g.itemsText} onChange={(e) => updateItem('technicalSkills', i, { itemsText: e.target.value })} />
            </div>
            <button type="button" onClick={() => removeItem('technicalSkills', i)} className="rounded-lg p-1.5 text-red-600 hover:bg-red-50" aria-label="Remove skill group">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </fieldset>

      {/* Experience */}
      <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <legend className="text-xs font-semibold uppercase tracking-wide text-brand-800">Experience</legend>
          <button type="button" className={btnAddCls} onClick={() => addItem('experience', { company: '', location: '', title: '', startDate: '', endDate: '', bulletsText: '' })}>
            <Plus className="h-3.5 w-3.5" /> Add experience
          </button>
        </div>
        {form.experience.map((ex, i) => (
          <div key={i} className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="flex justify-between">
              <span className="text-xs font-semibold text-slate-700">Role #{i + 1}</span>
              <button type="button" onClick={() => removeItem('experience', i)} className="text-xs text-red-600 hover:underline">Remove</button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={inputCls} placeholder="Company *" value={ex.company} onChange={(e) => updateItem('experience', i, { company: e.target.value })} />
              <input className={inputCls} placeholder="Job Title" value={ex.title} onChange={(e) => updateItem('experience', i, { title: e.target.value })} />
              <input className={inputCls} placeholder="Location" value={ex.location} onChange={(e) => updateItem('experience', i, { location: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <input className={inputCls} placeholder="Start (e.g. Jan 2023)" value={ex.startDate} onChange={(e) => updateItem('experience', i, { startDate: e.target.value })} />
                <input className={inputCls} placeholder="End (e.g. Present)" value={ex.endDate} onChange={(e) => updateItem('experience', i, { endDate: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Bullets (one per line)</label>
              <textarea className={inputCls} rows={3} value={ex.bulletsText} onChange={(e) => updateItem('experience', i, { bulletsText: e.target.value })} />
            </div>
          </div>
        ))}
      </fieldset>

      {/* Projects */}
      <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <legend className="text-xs font-semibold uppercase tracking-wide text-brand-800">Projects</legend>
          <button type="button" className={btnAddCls} onClick={() => addItem('projects', { name: '', techText: '', bulletsText: '' })}>
            <Plus className="h-3.5 w-3.5" /> Add project
          </button>
        </div>
        {form.projects.map((p, i) => (
          <div key={i} className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="flex justify-between">
              <span className="text-xs font-semibold text-slate-700">Project #{i + 1}</span>
              <button type="button" onClick={() => removeItem('projects', i)} className="text-xs text-red-600 hover:underline">Remove</button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={inputCls} placeholder="Project Name *" value={p.name} onChange={(e) => updateItem('projects', i, { name: e.target.value })} />
              <input className={inputCls} placeholder="Technologies (comma-separated)" value={p.techText} onChange={(e) => updateItem('projects', i, { techText: e.target.value })} />
            </div>
            <textarea className={inputCls} rows={2} placeholder="Bullets (one per line)" value={p.bulletsText} onChange={(e) => updateItem('projects', i, { bulletsText: e.target.value })} />
          </div>
        ))}
      </fieldset>

      {/* Certifications */}
      <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <legend className="text-xs font-semibold uppercase tracking-wide text-brand-800">Certifications</legend>
          <button type="button" className={btnAddCls} onClick={() => addItem('certifications', { name: '', issuer: '', date: '', credentialId: '' })}>
            <Plus className="h-3.5 w-3.5" /> Add certification
          </button>
        </div>
        {form.certifications.map((c, i) => (
          <div key={i} className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="flex justify-between">
              <span className="text-xs font-semibold text-slate-700">Certification #{i + 1}</span>
              <button type="button" onClick={() => removeItem('certifications', i)} className="text-xs text-red-600 hover:underline">Remove</button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={inputCls} placeholder="Certification Name *" value={c.name} onChange={(e) => updateItem('certifications', i, { name: e.target.value })} />
              <input className={inputCls} placeholder="Issuer (e.g. AWS, Coursera)" value={c.issuer} onChange={(e) => updateItem('certifications', i, { issuer: e.target.value })} />
              <input className={inputCls} placeholder="Date (e.g. Jun 2024)" value={c.date} onChange={(e) => updateItem('certifications', i, { date: e.target.value })} />
              <input className={inputCls} placeholder="Credential ID (optional)" value={c.credentialId} onChange={(e) => updateItem('certifications', i, { credentialId: e.target.value })} />
            </div>
          </div>
        ))}
      </fieldset>

      {/* Education */}
      <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <legend className="text-xs font-semibold uppercase tracking-wide text-brand-800">Education</legend>
          <button type="button" className={btnAddCls} onClick={() => addItem('education', { institution: '', location: '', degree: '', score: '', startDate: '', endDate: '' })}>
            <Plus className="h-3.5 w-3.5" /> Add education
          </button>
        </div>
        {form.education.map((ed, i) => (
          <div key={i} className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="flex justify-between">
              <span className="text-xs font-semibold text-slate-700">Education #{i + 1}</span>
              <button type="button" onClick={() => removeItem('education', i)} className="text-xs text-red-600 hover:underline">Remove</button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={inputCls} placeholder="Institution *" value={ed.institution} onChange={(e) => updateItem('education', i, { institution: e.target.value })} />
              <input className={inputCls} placeholder="Degree" value={ed.degree} onChange={(e) => updateItem('education', i, { degree: e.target.value })} />
              <input className={inputCls} placeholder="Location" value={ed.location} onChange={(e) => updateItem('education', i, { location: e.target.value })} />
              <input className={inputCls} placeholder="GPA / Score" value={ed.score} onChange={(e) => updateItem('education', i, { score: e.target.value })} />
              <input className={inputCls} placeholder="Start Date" value={ed.startDate} onChange={(e) => updateItem('education', i, { startDate: e.target.value })} />
              <input className={inputCls} placeholder="End Date" value={ed.endDate} onChange={(e) => updateItem('education', i, { endDate: e.target.value })} />
            </div>
          </div>
        ))}
      </fieldset>

      {/* Achievements */}
      <fieldset className="space-y-2 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-brand-800">Achievements (one per line)</legend>
        <textarea className={inputCls} rows={3} value={form.achievementsText} onChange={(e) => setForm((f) => ({ ...f, achievementsText: e.target.value }))} />
      </fieldset>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <X className="h-4 w-4" /> Cancel
        </button>
        <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save profile
        </button>
      </div>
    </form>
  );
}
