import { ChevronRight, Quote, ShieldCheck, Sparkles } from 'lucide-react';
import { CATEGORY_LABELS, CLASS_META, CLASSIFICATIONS, IMPORTANCE_LABELS } from './classification';

const DECIDED_BY = {
  rules: { label: 'Verified by matching rules', icon: ShieldCheck },
  ai: { label: 'AI assessment, evidence verified', icon: Sparkles },
  'ai+rules': { label: 'AI suggestion confirmed by matching rules', icon: ShieldCheck },
};

export function EvidenceList({ evidence }) {
  if (!evidence?.length) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence from your master resume</h4>
      <ul className="mt-1.5 space-y-1.5">
        {evidence.map((e) => (
          <li key={e.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="flex gap-2 text-sm text-slate-800">
              <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              <span>{e.text}</span>
            </p>
            <p className="mt-0.5 pl-5 text-xs text-slate-500">{e.source}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExplanationBody({ item }) {
  const decided = DECIDED_BY[item.decidedBy];
  return (
    <div className="space-y-3 border-t border-slate-100 px-4 py-3 text-sm">
      <p className="text-slate-700">{item.explanation}</p>
      {item.relatedSkills?.length > 0 && (
        <p className="text-slate-600">
          <span className="font-medium">Related skill{item.relatedSkills.length > 1 ? 's' : ''} in your resume (not the same, no credit):</span> {item.relatedSkills.join(', ')}
        </p>
      )}
      <EvidenceList evidence={item.evidence} />
      {item.adjustments?.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-medium">Adjusted by the matching rules</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {item.adjustments.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        {decided && (
          <span className="inline-flex items-center gap-1">
            <decided.icon className="h-3.5 w-3.5" aria-hidden="true" /> {decided.label}
          </span>
        )}
        {item.variants?.length > 1 && <span>Also written as: {item.variants.slice(1).join(', ')}</span>}
        {item.normalizedName && item.normalizedName !== item.keyword && <span>Standard name: {item.normalizedName}</span>}
      </div>
    </div>
  );
}

function RequirementItem({ item }) {
  const meta = CLASS_META[item.classification];
  return (
    <li id={`req-${encodeURIComponent(item.keyword)}`} className="scroll-mt-24">
      <details className="group rounded-lg border border-slate-200 bg-white open:shadow-sm">
        <summary className="flex cursor-pointer select-none list-none items-center gap-3 px-4 py-2.5 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" aria-hidden="true" />
          <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{item.keyword}</span>
          <span className="hidden text-xs text-slate-500 sm:inline">{CATEGORY_LABELS[item.category] ?? item.category}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${item.importance === 'must_have' ? 'bg-brand-50 text-brand-800' : 'bg-slate-100 text-slate-600'}`}>
            {IMPORTANCE_LABELS[item.importance]}
          </span>
        </summary>
        <ExplanationBody item={item} />
      </details>
    </li>
  );
}

export default function RequirementGroups({ requirements }) {
  return (
    <section className="space-y-5" aria-labelledby="requirements-heading">
      <div>
        <h2 id="requirements-heading" className="font-semibold text-slate-900">
          Skill-by-skill comparison
        </h2>
        <p className="text-sm text-slate-600">Open any keyword to see why it was classified that way and the resume evidence behind it.</p>
      </div>
      {CLASSIFICATIONS.map((c) => {
        const items = requirements.filter((r) => r.classification === c);
        const meta = CLASS_META[c];
        return (
          <div key={c}>
            <h3 className={`flex items-center gap-2 text-sm font-semibold ${meta.text}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} aria-hidden="true" />
              {meta.plural} ({items.length})
            </h3>
            <p className="text-xs text-slate-500">{meta.description}</p>
            {items.length ? (
              <ul className="mt-2 space-y-1.5">
                {items.map((item) => (
                  <RequirementItem key={item.id} item={item} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-400">None.</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
