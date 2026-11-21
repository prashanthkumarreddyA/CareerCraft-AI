// Read-only view of the extracted master resume, in the original section order.

function Section({ title, children }) {
  return (
    <section className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-800">{title}</h3>
      <div className="mt-2 text-sm text-slate-700">{children}</div>
    </section>
  );
}

function Bullets({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-1.5 list-disc space-y-1 pl-5">
      {items.map((b, i) => (
        <li key={i}>{b}</li>
      ))}
    </ul>
  );
}

const range = (e) => [e.startDate, e.endDate].filter(Boolean).join(' – ');

const SECTION_RENDERERS = {
  summary: (r) => <p className="leading-relaxed">{r.summary}</p>,
  technicalSkills: (r) => (
    <dl className="space-y-2">
      {r.technicalSkills.map((s) => (
        <div key={s.category}>
          <dt className="font-medium text-slate-900">{s.category}</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {s.items.map((item) => (
              <span key={item} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {item}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  ),
  experience: (r) => (
    <div className="space-y-4">
      {r.experience.map((e, i) => (
        <div key={i}>
          <p className="font-medium text-slate-900">
            {e.title} · {e.company}
          </p>
          <p className="text-xs text-slate-500">{[e.location, range(e)].filter(Boolean).join(' · ')}</p>
          <Bullets items={e.bullets} />
        </div>
      ))}
    </div>
  ),
  projects: (r) => (
    <div className="space-y-4">
      {r.projects.map((p, i) => (
        <div key={i}>
          <p className="font-medium text-slate-900">{p.name}</p>
          {p.technologies.length > 0 && <p className="text-xs text-slate-500">{p.technologies.join(', ')}</p>}
          <Bullets items={p.bullets} />
        </div>
      ))}
    </div>
  ),
  education: (r) => (
    <div className="space-y-3">
      {r.education.map((e, i) => (
        <div key={i}>
          <p className="font-medium text-slate-900">{e.institution}</p>
          <p>{[e.degree, e.score].filter(Boolean).join('; ')}</p>
          <p className="text-xs text-slate-500">{[e.location, range(e)].filter(Boolean).join(' · ')}</p>
        </div>
      ))}
    </div>
  ),
  achievements: (r) => <Bullets items={r.achievements} />,
};

export default function ResumeDetails({ resume }) {
  const info = resume.personalInfo;
  const contact = [info.location, info.phone, info.email, info.linkedin, info.github, ...info.other].filter(Boolean);
  return (
    <div className="space-y-4">
      <Section title="Header">
        <p className="text-base font-semibold text-slate-900">{info.fullName}</p>
        {resume.headline && <p className="font-medium">{resume.headline}</p>}
        <p className="mt-1 text-xs text-slate-500">{contact.join(' · ')}</p>
      </Section>
      {resume.sectionOrder.map(({ key, heading }) => (
        <Section key={key} title={heading}>
          {SECTION_RENDERERS[key](resume)}
        </Section>
      ))}
    </div>
  );
}
