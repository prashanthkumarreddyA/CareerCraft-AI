// Fictional resume with the SAME STRUCTURE as the owner's real master resume (which is never
// committed): headline "Full Stack Developer | …", a summary that opens with that identity,
// seven skill groups in the same order, and NestJS / GraphQL / AWS Lambda named ONLY in the
// skills list, while the experience bullets name the related Express.js and AWS EC2.
// All names, companies and wording are invented.
import { sampleResume } from './fixtures.js';

export const realStructureResume = {
  ...structuredClone(sampleResume),
  headline: 'Full Stack Developer | TypeScript | Node.js | React.js',
  summary:
    'Full Stack Developer with 4+ years of experience creating customer portals using Node.js, Express.js, React.js, TypeScript, MongoDB, and MySQL. ' +
    'Focused on server-side work such as RESTful APIs, JWT authentication, and queue-based background jobs on Redis and BullMQ. ' +
    'Experienced in automating CI/CD deployments to AWS EC2. Collaborates in Agile/Scrum squads on customer-facing releases.',
  technicalSkills: [
    { category: 'Languages', items: ['JavaScript (ES6+)', 'TypeScript', 'SQL'] },
    { category: 'Backend', items: ['Node.js', 'Express.js', 'NestJS', 'RESTful APIs', 'GraphQL', 'Microservices'] },
    { category: 'Frontend', items: ['React.js', 'Next.js', 'Redux Toolkit', 'Tailwind CSS'] },
    { category: 'Databases', items: ['MySQL', 'MongoDB', 'Redis'] },
    { category: 'Cloud & DevOps', items: ['AWS EC2', 'AWS Lambda', 'AWS S3', 'GitHub Actions', 'CI/CD'] },
    { category: 'APIs & Integrations', items: ['Payment Gateway Integration', 'Third-Party APIs'] },
    { category: 'Tools & Practices', items: ['BullMQ', 'Git', 'Postman', 'Agile/Scrum'] },
  ],
  experience: [
    {
      ...sampleResume.experience[0],
      title: 'Software Engineer',
      bullets: [
        'Develop and maintain order management services with Node.js, Express.js and MongoDB.',
        'Built 20+ RESTful APIs with JWT authentication and role-based access for internal tools.',
        'Implemented queue-based background jobs on Redis and BullMQ for nightly report generation.',
        'Contributed to the migration of reporting services to AWS EC2 with GitHub Actions pipelines.',
        'Led weekly code reviews for the payments module.',
      ],
    },
    {
      ...sampleResume.experience[1],
      title: 'Junior Software Engineer',
      bullets: ['Built reusable React.js components for an internal dashboard.', 'Integrated third-party payment APIs into production applications.'],
    },
  ],
};

/** The same resume without the skills that only the skills list names (to prove the evidence rules still hold). */
export const withoutListedSkills = (names) => ({
  ...structuredClone(realStructureResume),
  technicalSkills: realStructureResume.technicalSkills.map((g) => ({ ...g, items: g.items.filter((i) => !names.includes(i)) })),
});
