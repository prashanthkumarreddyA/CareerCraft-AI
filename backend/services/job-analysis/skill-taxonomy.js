/**
 * Curated technology taxonomy used for deterministic matching.
 *
 * Equivalence is deliberately narrow:
 *  - aliases   = spellings of the SAME thing (React = React.js = ReactJS). Only these count as a match.
 *  - parent    = the child is a specific part of the parent (AWS EC2 → AWS). Naming the child is
 *                evidence for the parent, never the other way round.
 *  - family / related = similar but DIFFERENT technologies (Express vs NestJS, EC2 vs Lambda,
 *                MySQL vs PostgreSQL). These can only ever produce RELATED_EXPERIENCE.
 *  - Technologies with no relation (Docker vs AWS) are never connected.
 *
 * Alias syntax: a leading "=" makes the alias case-sensitive (for ambiguous words: "Go", "Express").
 * concept: true marks practices/concepts (REST, CI/CD, RBAC). These may be supported by described
 * experience; concrete technologies must be named in the resume to count.
 */

// [id, display name, category, aliases, options]
const ENTRIES = [
  // --- Languages ---
  ['javascript', 'JavaScript', 'language', ['JavaScript', 'Java Script', 'ES6', 'ES6+', 'ES2015', 'ECMAScript', '=JS'], { related: ['typescript'] }],
  ['typescript', 'TypeScript', 'language', ['TypeScript', 'Type Script'], { related: ['javascript'] }],
  ['python', 'Python', 'language', ['Python', 'Python3', 'Python 3']],
  ['java', 'Java', 'language', ['Java', 'Core Java', 'Java 8', 'Java 11', 'Java 17'], { related: ['kotlin'] }],
  ['kotlin', 'Kotlin', 'language', ['Kotlin'], { related: ['java'] }],
  ['csharp', 'C#', 'language', ['C#', 'C Sharp', 'CSharp']],
  ['cpp', 'C++', 'language', ['C++', 'CPP'], { related: ['c'] }],
  ['c', 'C', 'language', ['=C'], { related: ['cpp'] }],
  ['go', 'Go', 'language', ['=Go', 'Golang', '=GoLang']],
  ['rust', 'Rust', 'language', ['=Rust']],
  ['ruby', 'Ruby', 'language', ['=Ruby']],
  ['php', 'PHP', 'language', ['PHP']],
  ['swift', 'Swift', 'language', ['=Swift']],
  ['dart', 'Dart', 'language', ['=Dart']],
  ['scala', 'Scala', 'language', ['=Scala']],
  ['sql', 'SQL', 'language', ['SQL', 'T-SQL', 'PL/SQL']],
  ['html', 'HTML', 'frontend', ['HTML', 'HTML5', 'HTML 5']],
  ['css', 'CSS', 'frontend', ['CSS', 'CSS3', 'CSS 3']],
  ['bash', 'Bash / Shell scripting', 'tool', ['Bash', 'Shell scripting', 'Shell script', 'Shell scripts']],

  // --- Frontend ---
  ['react', 'React', 'frontend', ['React', 'React.js', 'ReactJS', 'React JS'], { related: ['react-native', 'nextjs'], family: 'spa-framework' }],
  ['react-native', 'React Native', 'frontend', ['React Native', 'React-Native'], { related: ['react', 'flutter'] }],
  ['flutter', 'Flutter', 'frontend', ['Flutter'], { related: ['react-native'] }],
  ['angular', 'Angular', 'frontend', ['Angular', 'Angular 2+'], { family: 'spa-framework', related: ['angularjs'] }],
  ['angularjs', 'AngularJS', 'frontend', ['AngularJS', 'Angular.js', 'Angular JS'], { related: ['angular'] }],
  ['vue', 'Vue.js', 'frontend', ['Vue', 'Vue.js', 'VueJS', 'Vue JS', 'Vue 3'], { family: 'spa-framework', related: ['nuxt'] }],
  ['svelte', 'Svelte', 'frontend', ['Svelte', 'SvelteKit'], { family: 'spa-framework' }],
  ['nextjs', 'Next.js', 'frontend', ['Next.js', 'NextJS', 'Next JS'], { related: ['react', 'nuxt'] }],
  ['nuxt', 'Nuxt', 'frontend', ['Nuxt', 'Nuxt.js', 'NuxtJS'], { related: ['vue', 'nextjs'] }],
  ['redux', 'Redux', 'frontend', ['Redux'], { family: 'state-management' }],
  ['redux-toolkit', 'Redux Toolkit', 'frontend', ['Redux Toolkit', 'RTK', 'ReduxToolkit'], { parent: 'redux' }],
  ['zustand', 'Zustand', 'frontend', ['Zustand'], { family: 'state-management' }],
  ['mobx', 'MobX', 'frontend', ['MobX'], { family: 'state-management' }],
  ['context-api', 'React Context API', 'frontend', ['Context API', 'React Context'], { family: 'state-management' }],
  ['react-hooks', 'React Hooks', 'frontend', ['React Hooks'], { parent: 'react' }],
  ['tailwind', 'Tailwind CSS', 'frontend', ['Tailwind', 'Tailwind CSS', 'TailwindCSS'], { family: 'css-framework' }],
  ['bootstrap', 'Bootstrap', 'frontend', ['Bootstrap'], { family: 'css-framework' }],
  ['material-ui', 'Material UI', 'frontend', ['Material UI', 'Material-UI', 'MUI'], { family: 'css-framework' }],
  ['sass', 'Sass/SCSS', 'frontend', ['Sass', 'SCSS']],
  ['jquery', 'jQuery', 'frontend', ['jQuery']],
  ['webpack', 'Webpack', 'tool', ['Webpack'], { family: 'bundler' }],
  ['vite', 'Vite', 'tool', ['Vite'], { family: 'bundler' }],
  ['responsive-design', 'Responsive design', 'frontend', ['Responsive Design', 'Responsive web design', 'Responsive UI', 'Responsive layouts'], { concept: true }],

  // --- Backend ---
  ['nodejs', 'Node.js', 'backend', ['Node.js', 'NodeJS', 'Node JS', '=Node']],
  ['express', 'Express.js', 'backend', ['Express.js', 'ExpressJS', 'Express JS', '=Express'], { family: 'node-framework' }],
  ['nestjs', 'NestJS', 'backend', ['NestJS', 'Nest.js', 'Nest JS'], { family: 'node-framework' }],
  ['fastify', 'Fastify', 'backend', ['Fastify'], { family: 'node-framework' }],
  ['koa', 'Koa', 'backend', ['Koa', 'Koa.js'], { family: 'node-framework' }],
  ['django', 'Django', 'backend', ['Django'], { family: 'python-framework' }],
  ['flask', 'Flask', 'backend', ['Flask'], { family: 'python-framework' }],
  ['fastapi', 'FastAPI', 'backend', ['FastAPI'], { family: 'python-framework' }],
  ['spring', 'Spring', 'backend', ['=Spring', 'Spring Framework'], { family: 'java-framework' }],
  ['spring-boot', 'Spring Boot', 'backend', ['Spring Boot', 'SpringBoot'], { parent: 'spring' }],
  ['dotnet', '.NET', 'backend', ['.NET', 'dotnet', '.NET Core', 'ASP.NET', 'ASP.NET Core'], { related: ['csharp'] }],
  ['laravel', 'Laravel', 'backend', ['Laravel'], { related: ['php'] }],
  ['rails', 'Ruby on Rails', 'backend', ['Ruby on Rails', '=Rails', 'RoR'], { related: ['ruby'] }],
  ['socketio', 'Socket.IO', 'backend', ['Socket.IO', 'SocketIO', 'Socket IO'], { related: ['websockets'] }],
  ['websockets', 'WebSockets', 'api', ['WebSocket', 'WebSockets', 'Web Sockets', 'WSS'], { related: ['socketio'] }],
  ['cron', 'Cron jobs / scheduled tasks', 'backend', ['Cron', 'Cron Jobs', 'Cron jobs', 'CronJob', 'node-cron'], { concept: true }],
  ['background-jobs', 'Background job processing', 'backend', ['Background jobs', 'Background job processing', 'Background processing', 'Job queues', 'Task queues'], { concept: true }],

  // --- Message queues / streaming ---
  ['bullmq', 'BullMQ', 'backend', ['BullMQ', 'Bull MQ', '=Bull'], { family: 'queue', parent: 'background-jobs', related: ['redis'] }],
  ['rabbitmq', 'RabbitMQ', 'backend', ['RabbitMQ', 'Rabbit MQ'], { family: 'queue' }],
  ['kafka', 'Apache Kafka', 'backend', ['Kafka', 'Apache Kafka'], { family: 'queue' }],
  ['aws-sqs', 'AWS SQS', 'cloud', ['SQS', 'AWS SQS', 'Amazon SQS'], { family: 'queue', parent: 'aws' }],

  // --- Databases & ORMs ---
  ['mongodb', 'MongoDB', 'database', ['MongoDB', 'Mongo DB', '=Mongo'], { family: 'nosql', related: ['mongoose'] }],
  ['mongoose', 'Mongoose', 'database', ['Mongoose'], { family: 'orm', related: ['mongodb'] }],
  ['mysql', 'MySQL', 'database', ['MySQL', 'My SQL'], { family: 'relational' }],
  ['postgresql', 'PostgreSQL', 'database', ['PostgreSQL', 'Postgres', 'Postgre SQL', 'PSQL'], { family: 'relational' }],
  ['mssql', 'Microsoft SQL Server', 'database', ['SQL Server', 'MS SQL', 'MSSQL', 'Microsoft SQL Server'], { family: 'relational' }],
  ['oracle-db', 'Oracle Database', 'database', ['Oracle Database', 'Oracle DB', '=Oracle'], { family: 'relational' }],
  ['mariadb', 'MariaDB', 'database', ['MariaDB'], { family: 'relational' }],
  ['sqlite', 'SQLite', 'database', ['SQLite'], { family: 'relational' }],
  ['redis', 'Redis', 'database', ['Redis'], { family: 'cache' }],
  ['memcached', 'Memcached', 'database', ['Memcached'], { family: 'cache' }],
  ['elasticsearch', 'Elasticsearch', 'database', ['Elasticsearch', 'Elastic Search', 'OpenSearch']],
  ['dynamodb', 'Amazon DynamoDB', 'database', ['DynamoDB', 'Dynamo DB'], { family: 'nosql', parent: 'aws' }],
  ['cassandra', 'Apache Cassandra', 'database', ['Cassandra'], { family: 'nosql' }],
  ['firebase', 'Firebase', 'cloud', ['Firebase', 'Firestore']],
  ['prisma', 'Prisma', 'database', ['Prisma'], { family: 'orm' }],
  ['sequelize', 'Sequelize', 'database', ['Sequelize'], { family: 'orm' }],
  ['typeorm', 'TypeORM', 'database', ['TypeORM'], { family: 'orm' }],
  ['nosql', 'NoSQL databases', 'database', ['NoSQL'], { concept: true }],
  ['rdbms', 'Relational databases', 'database', ['RDBMS', 'Relational databases', 'Relational database'], { concept: true }],

  // --- Cloud ---
  ['aws', 'AWS', 'cloud', ['AWS', 'Amazon Web Services'], { family: 'cloud-provider' }],
  ['aws-ec2', 'AWS EC2', 'cloud', ['EC2', 'AWS EC2', 'Amazon EC2'], { parent: 'aws' }],
  ['aws-s3', 'AWS S3', 'cloud', ['S3', 'AWS S3', 'Amazon S3'], { parent: 'aws' }],
  ['aws-lambda', 'AWS Lambda', 'cloud', ['AWS Lambda', 'Amazon Lambda', 'Lambda functions', '=Lambda'], { parent: 'aws', family: 'serverless-functions' }],
  ['aws-ecs', 'AWS ECS', 'cloud', ['ECS', 'AWS ECS', 'Amazon ECS', 'Fargate'], { parent: 'aws' }],
  ['aws-eks', 'AWS EKS', 'cloud', ['EKS', 'AWS EKS', 'Amazon EKS'], { parent: 'aws', related: ['kubernetes'] }],
  ['aws-rds', 'AWS RDS', 'cloud', ['RDS', 'AWS RDS', 'Amazon RDS', 'Aurora'], { parent: 'aws' }],
  ['aws-cloudfront', 'AWS CloudFront', 'cloud', ['CloudFront'], { parent: 'aws' }],
  ['aws-sns', 'AWS SNS', 'cloud', ['SNS', 'AWS SNS', 'Amazon SNS'], { parent: 'aws' }],
  ['aws-api-gateway', 'AWS API Gateway', 'cloud', ['API Gateway', 'AWS API Gateway', 'Amazon API Gateway'], { parent: 'aws' }],
  ['cloudformation', 'AWS CloudFormation', 'devops', ['CloudFormation'], { parent: 'aws', family: 'iac' }],
  ['azure', 'Microsoft Azure', 'cloud', ['Azure', 'Microsoft Azure'], { family: 'cloud-provider' }],
  ['azure-app-service', 'Azure App Service', 'cloud', ['Azure App Service', 'App Service'], { parent: 'azure' }],
  ['azure-functions', 'Azure Functions', 'cloud', ['Azure Functions'], { parent: 'azure', family: 'serverless-functions' }],
  ['azure-devops', 'Azure DevOps', 'devops', ['Azure DevOps', 'Azure Pipelines'], { parent: 'azure', family: 'ci-tool' }],
  ['gcp', 'Google Cloud Platform', 'cloud', ['GCP', 'Google Cloud', 'Google Cloud Platform'], { family: 'cloud-provider' }],
  ['gcp-functions', 'Google Cloud Functions', 'cloud', ['Cloud Functions', 'Google Cloud Functions'], { parent: 'gcp', family: 'serverless-functions' }],
  ['cloud-run', 'Google Cloud Run', 'cloud', ['Cloud Run'], { parent: 'gcp' }],
  ['heroku', 'Heroku', 'cloud', ['Heroku'], { family: 'paas' }],
  ['vercel', 'Vercel', 'cloud', ['Vercel'], { family: 'paas' }],
  ['netlify', 'Netlify', 'cloud', ['Netlify'], { family: 'paas' }],
  ['serverless', 'Serverless architecture', 'architecture', ['Serverless'], { concept: true }],

  // --- DevOps ---
  ['docker', 'Docker', 'devops', ['Docker', 'Dockerfile', 'Dockerfiles'], { parent: 'containerization' }],
  ['docker-compose', 'Docker Compose', 'devops', ['Docker Compose', 'docker-compose'], { parent: 'docker' }],
  ['containerization', 'Containerization', 'devops', ['Containerization', 'Containerisation', 'Containers', 'Containerized', 'Containerised'], { concept: true }],
  ['kubernetes', 'Kubernetes', 'devops', ['Kubernetes', 'K8s'], { parent: 'container-orchestration', related: ['aws-eks'] }],
  ['helm', 'Helm', 'devops', ['Helm', 'Helm charts'], { related: ['kubernetes'] }],
  ['container-orchestration', 'Container orchestration', 'devops', ['Container orchestration'], { concept: true }],
  ['terraform', 'Terraform', 'devops', ['Terraform'], { family: 'iac' }],
  ['ansible', 'Ansible', 'devops', ['Ansible'], { family: 'iac' }],
  ['iac', 'Infrastructure as Code', 'devops', ['Infrastructure as Code', 'IaC'], { concept: true }],
  ['ci-cd', 'CI/CD', 'devops', ['CI/CD', 'CI CD', 'CICD', 'CI-CD', 'Continuous Integration', 'Continuous Delivery', 'Continuous Deployment', 'CI/CD pipelines'], { concept: true }],
  ['github-actions', 'GitHub Actions', 'devops', ['GitHub Actions', 'GH Actions'], { family: 'ci-tool', parent: 'ci-cd' }],
  ['gitlab-ci', 'GitLab CI', 'devops', ['GitLab CI', 'GitLab CI/CD', 'GitLab Pipelines'], { family: 'ci-tool', parent: 'ci-cd' }],
  ['jenkins', 'Jenkins', 'devops', ['Jenkins'], { family: 'ci-tool', parent: 'ci-cd' }],
  ['circleci', 'CircleCI', 'devops', ['CircleCI', 'Circle CI'], { family: 'ci-tool', parent: 'ci-cd' }],
  ['git', 'Git', 'tool', ['Git'], { related: ['github', 'gitlab', 'bitbucket'] }],
  ['github', 'GitHub', 'tool', ['GitHub'], { family: 'git-hosting' }],
  ['gitlab', 'GitLab', 'tool', ['GitLab'], { family: 'git-hosting' }],
  ['bitbucket', 'Bitbucket', 'tool', ['Bitbucket'], { family: 'git-hosting' }],
  ['nginx', 'Nginx', 'devops', ['Nginx', 'NGINX'], { family: 'web-server' }],
  ['apache-httpd', 'Apache HTTP Server', 'devops', ['Apache HTTP Server', 'Apache httpd'], { family: 'web-server' }],
  ['linux', 'Linux', 'devops', ['Linux', 'Ubuntu', 'Unix']],
  ['monitoring', 'Monitoring & observability', 'devops', ['Monitoring', 'Observability', 'Logging and monitoring'], { concept: true }],
  ['prometheus', 'Prometheus', 'devops', ['Prometheus'], { family: 'monitoring-tool', parent: 'monitoring' }],
  ['grafana', 'Grafana', 'devops', ['Grafana'], { family: 'monitoring-tool', parent: 'monitoring' }],
  ['datadog', 'Datadog', 'devops', ['Datadog'], { family: 'monitoring-tool', parent: 'monitoring' }],

  // --- APIs & integration ---
  ['rest', 'REST APIs', 'api', ['REST', 'RESTful', 'REST API', 'REST APIs', 'RESTful API', 'RESTful APIs', 'RESTful services', 'RESTful web services'], { concept: true }],
  ['graphql', 'GraphQL', 'api', ['GraphQL', 'Graph QL'], { related: ['rest'] }],
  ['grpc', 'gRPC', 'api', ['gRPC'], { related: ['rest'] }],
  ['soap', 'SOAP', 'api', ['SOAP'], { related: ['rest'] }],
  ['openapi', 'OpenAPI / Swagger', 'api', ['OpenAPI', 'Swagger', 'Swagger/OpenAPI', 'API documentation', 'Swagger/API Documentation']],
  ['postman', 'Postman', 'tool', ['Postman']],
  ['webhooks', 'Webhooks', 'api', ['Webhook', 'Webhooks']],
  ['third-party-apis', 'Third-party API integration', 'api', ['Third-party APIs', 'Third party APIs', 'Third-party API', 'Third-party integrations', 'Third-party integration', 'External APIs', 'API integrations', 'API integration'], { concept: true }],
  ['payment-gateway', 'Payment gateway integration', 'api', ['Payment gateway', 'Payment gateways', 'Payment Gateway Integration', 'Payment integration', 'Payment integrations'], { concept: true, related: ['stripe', 'razorpay'] }],
  ['stripe', 'Stripe', 'api', ['Stripe'], { family: 'payment-provider' }],
  ['razorpay', 'Razorpay', 'api', ['Razorpay'], { family: 'payment-provider' }],
  ['sftp', 'SFTP', 'api', ['SFTP', 'FTP']],
  ['sap', 'SAP integration', 'api', ['=SAP', 'SAP Integration']],

  // --- Security ---
  ['jwt', 'JWT', 'security', ['JWT', 'JSON Web Token', 'JSON Web Tokens', 'JWT Authentication'], { family: 'auth-mechanism' }],
  ['oauth', 'OAuth 2.0', 'security', ['OAuth', 'OAuth2', 'OAuth 2.0', 'OAuth2.0'], { family: 'auth-mechanism' }],
  ['openid-connect', 'OpenID Connect', 'security', ['OpenID Connect', 'OIDC'], { family: 'auth-mechanism' }],
  ['sso', 'Single sign-on', 'security', ['SSO', 'Single Sign-On', 'Single sign on'], { family: 'auth-mechanism' }],
  ['authentication', 'Authentication', 'security', ['Authentication', 'Auth'], { concept: true }],
  ['authorization', 'Authorization', 'security', ['Authorization', 'Authorisation', 'Access control'], { concept: true }],
  ['rbac', 'Role-based access control', 'security', ['RBAC', 'Role-Based Access Control', 'Role based access control', 'Role-based access', 'Role-based authorization', 'Role-based permissions'], { concept: true, parent: 'authorization' }],
  ['owasp', 'OWASP', 'security', ['OWASP', 'OWASP Top 10'], { concept: true }],
  ['encryption', 'Encryption', 'security', ['Encryption', 'TLS', 'SSL/TLS'], { concept: true }],

  // --- Testing ---
  ['jest', 'Jest', 'testing', ['Jest'], { family: 'js-test-framework', parent: 'unit-testing' }],
  ['vitest', 'Vitest', 'testing', ['Vitest'], { family: 'js-test-framework', parent: 'unit-testing' }],
  ['mocha', 'Mocha', 'testing', ['Mocha'], { family: 'js-test-framework', parent: 'unit-testing' }],
  ['chai', 'Chai', 'testing', ['Chai'], { family: 'js-test-framework' }],
  ['supertest', 'Supertest', 'testing', ['Supertest'], { family: 'js-test-framework' }],
  ['react-testing-library', 'React Testing Library', 'testing', ['React Testing Library', 'Testing Library', 'RTL'], { family: 'js-test-framework' }],
  ['cypress', 'Cypress', 'testing', ['Cypress'], { family: 'e2e-test-tool', parent: 'e2e-testing' }],
  ['playwright', 'Playwright', 'testing', ['Playwright'], { family: 'e2e-test-tool', parent: 'e2e-testing' }],
  ['selenium', 'Selenium', 'testing', ['Selenium'], { family: 'e2e-test-tool', parent: 'e2e-testing' }],
  ['puppeteer', 'Puppeteer', 'tool', ['Puppeteer'], { related: ['playwright'] }],
  ['unit-testing', 'Unit testing', 'testing', ['Unit testing', 'Unit tests', 'Unit test'], { concept: true }],
  ['e2e-testing', 'End-to-end testing', 'testing', ['End-to-end testing', 'E2E testing', 'E2E tests', 'End-to-end tests'], { concept: true }],
  ['tdd', 'Test-driven development', 'testing', ['TDD', 'Test-driven development', 'Test driven development'], { concept: true }],

  // --- Architecture & practices ---
  ['microservices', 'Microservices', 'architecture', ['Microservices', 'Micro-services', 'Microservice', 'Microservice architecture'], { concept: true }],
  ['event-driven', 'Event-driven architecture', 'architecture', ['Event-driven', 'Event driven', 'Event-driven architecture'], { concept: true }],
  ['system-design', 'System design', 'architecture', ['System design', 'Systems design'], { concept: true }],
  ['design-patterns', 'Design patterns', 'architecture', ['Design patterns'], { concept: true }],
  ['mvc', 'MVC', 'architecture', ['MVC', 'Model-View-Controller'], { concept: true }],
  ['distributed-systems', 'Distributed systems', 'architecture', ['Distributed systems'], { concept: true }],
  ['scalability', 'Scalable systems', 'architecture', ['Scalable', 'Scalability'], { concept: true }],
  ['caching', 'Caching', 'architecture', ['Caching', 'Cache'], { concept: true }],
  ['performance-optimization', 'Performance optimization', 'architecture', ['Performance optimization', 'Performance optimisation', 'Query optimization', 'Query optimisation', 'Performance tuning'], { concept: true }],
  ['agile', 'Agile', 'methodology', ['Agile', 'Agile methodologies', 'Agile/Scrum'], { concept: true }],
  ['scrum', 'Scrum', 'methodology', ['Scrum', 'Sprints', 'Sprint'], { concept: true, parent: 'agile' }],
  ['kanban', 'Kanban', 'methodology', ['Kanban'], { concept: true, parent: 'agile' }],
  ['jira', 'Jira', 'tool', ['Jira', 'JIRA']],
  ['vscode', 'VS Code', 'tool', ['VS Code', 'VSCode', 'Visual Studio Code']],
  ['code-review', 'Code reviews', 'methodology', ['Code review', 'Code reviews'], { concept: true }],
  ['dsa', 'Data structures & algorithms', 'other', ['Data structures', 'Algorithms', 'Data Structures and Algorithms', 'DSA'], { concept: true }],
  ['oop', 'Object-oriented programming', 'other', ['OOP', 'OOPS', 'Object-oriented programming', 'Object oriented programming'], { concept: true }],
];

export const CATEGORIES = ['language', 'frontend', 'backend', 'framework', 'database', 'cloud', 'devops', 'api', 'architecture', 'security', 'testing', 'tool', 'methodology', 'other'];

/** Concrete technology categories: such requirements only count when the resume names them. */
export const TECHNOLOGY_CATEGORIES = new Set(['language', 'frontend', 'backend', 'framework', 'database', 'cloud', 'devops', 'api', 'testing', 'tool']);

/** Comparison key: case-, space- and punctuation-insensitive ("Express.js" = "ExpressJS" = "express js"). */
export function normalizeKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\+\+/g, 'pp')
    .replace(/#/g, 'sharp')
    .replace(/^\./, 'dot')
    .replace(/[^a-z0-9+]/g, '');
}

/** Same key without a trailing "js" ("expressjs" → "express"); only used when unambiguous. */
const stripJs = (key) => (key.length > 4 && key.endsWith('js') ? key.slice(0, -2) : key);

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Regex for one alias with technology-aware boundaries (so "Java" never matches "JavaScript"). */
export function aliasPattern(alias) {
  const caseSensitive = alias.startsWith('=');
  const body = escapeRegExp(caseSensitive ? alias.slice(1) : alias).replace(/\\ |\s+/g, '[\\s-]*');
  return new RegExp(`(?<![A-Za-z0-9#+])${body}(?![A-Za-z0-9#+]|\\.[A-Za-z0-9])`, caseSensitive ? 'g' : 'gi');
}

function buildTaxonomy(entries) {
  const byId = new Map();
  for (const [id, name, category, aliases, opts = {}] of entries) {
    if (byId.has(id)) throw new Error(`Duplicate taxonomy id ${id}`);
    if (!CATEGORIES.includes(category)) throw new Error(`Unknown category ${category} for ${id}`);
    byId.set(id, {
      id,
      name,
      category,
      aliases,
      concept: Boolean(opts.concept),
      parent: opts.parent ?? null,
      family: opts.family ?? null,
      related: new Set(opts.related ?? []),
      patterns: aliases.map(aliasPattern),
    });
  }
  // Validate references and make "related" symmetric.
  for (const entry of byId.values()) {
    if (entry.parent && !byId.has(entry.parent)) throw new Error(`Unknown parent ${entry.parent} for ${entry.id}`);
    for (const r of entry.related) {
      if (!byId.has(r)) throw new Error(`Unknown related id ${r} for ${entry.id}`);
      byId.get(r).related.add(entry.id);
    }
  }
  // Exact keys must be unique. "js"-stripped keys ("vuejs" → "vue") are a fallback that only
  // applies when no exact key exists and no two entries share it (Angular ≠ AngularJS).
  const aliasIndex = new Map();
  const strippedIndex = new Map();
  for (const entry of byId.values()) {
    for (const key of new Set([entry.name, ...entry.aliases].map((a) => normalizeKey(a.replace(/^=/, ''))))) {
      const existing = aliasIndex.get(key);
      if (existing && existing !== entry.id) throw new Error(`Alias collision "${key}": ${existing} / ${entry.id}`);
      aliasIndex.set(key, entry.id);
      const stripped = stripJs(key);
      if (stripped !== key) strippedIndex.set(stripped, strippedIndex.has(stripped) && strippedIndex.get(stripped) !== entry.id ? null : entry.id);
    }
  }
  for (const [key, id] of strippedIndex) if (id && !aliasIndex.has(key)) aliasIndex.set(key, id);
  return { byId, aliasIndex };
}

const { byId, aliasIndex } = buildTaxonomy(ENTRIES);

export const getEntry = (id) => byId.get(id) ?? null;
export const allEntries = () => [...byId.values()];

/** Resolves a skill name to a taxonomy id, or null when the taxonomy does not know it. */
export function lookupSkill(...names) {
  for (const name of names) {
    if (!name) continue;
    const key = normalizeKey(name);
    const id = aliasIndex.get(key) ?? aliasIndex.get(stripJs(key));
    if (id) return id;
  }
  return null;
}

/** Ancestors of an entry, nearest first (aws-ec2 → [aws]). */
export function ancestorsOf(id) {
  const out = [];
  let current = byId.get(id)?.parent;
  while (current && !out.includes(current)) {
    out.push(current);
    current = byId.get(current)?.parent;
  }
  return out;
}

/** True when `candidate` is `id` itself or a more specific part of it (naming it proves `id`). */
export function provesSkill(candidate, id) {
  return candidate === id || ancestorsOf(candidate).includes(id);
}

/**
 * Relation between a requirement and a different skill found in the resume, or null.
 * These relations only ever support RELATED_EXPERIENCE, never a match.
 */
export function relationBetween(requirementId, resumeSkillId) {
  if (requirementId === resumeSkillId) return null;
  const req = byId.get(requirementId);
  const skill = byId.get(resumeSkillId);
  if (!req || !skill) return null;
  if (ancestorsOf(requirementId).includes(resumeSkillId)) return 'broader skill'; // JD: AWS Lambda, resume: AWS
  if (req.parent && req.parent === skill.parent && !req.concept && !skill.concept) return 'same platform'; // EC2 vs Lambda
  // The resume skill or the platform it belongs to (AWS EC2 → AWS) may be related to the requirement
  // (JD: Azure, resume: AWS EC2 → related cloud provider). Concept ancestors are not used.
  const candidates = [resumeSkillId, ...ancestorsOf(resumeSkillId).filter((id) => !byId.get(id).concept)];
  for (const id of candidates) {
    if (id === requirementId) continue;
    if (req.related.has(id)) return 'related technology';
    if (req.family && req.family === byId.get(id).family) return 'same family';
  }
  return null;
}
