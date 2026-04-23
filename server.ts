/**
 * Mock Campus / KPI-ID API  –  local dev & testing
 * ─────────────────────────────────────────────────
 * Run:   npx tsx server.ts
 *        PORT=4000 npx tsx server.ts
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  Endpoints                                                               │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │  GET /group/all                         → raw groups.json array         │
 * │  GET /api/ticket?ticketId=&appId=&...   → { data: KpiIdUserInfo }       │
 * │  GET /api/integration/voteoss/students/:STUDENT_ID → CampusUserInfo     │
 * │  GET /students                          → cheat-sheet (all tickets)     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  Dynamic ticket IDs (deterministic – same input → same output always)   │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │  s1 … s100          any random group from any faculty                   │
 * │  s1@ФІОТ            student scoped to faculty  ФІОТ                     │
 * │  s7@КА-31           student scoped to group    КА-31                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  Predefined ticket IDs                                                   │
 * ├────────────────┬─────────────────────────────────────────────────────────┤
 * │  employee      │ NotStudentError  – EMPLOYEE_ID set, STUDENT_ID empty    │
 * │  both          │ valid student who is also an employee                   │
 * │  no-diia       │ NotDiiaAuthError – AUTH_METHOD = BANK_ID                │
 * │  invalid       │ InvalidUserDataError – STUDENT_ID and NAME empty        │
 * │  academic      │ NotStudyingError – campus status = OnAcademicLeave      │
 * │  dismissed     │ NotStudyingError – campus status = Dismissed            │
 * └────────────────┴─────────────────────────────────────────────────────────┘
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);

// ─────────────────────────────────────────────────────────────────────────────
// Groups  (loaded once from groups.json – treated as immutable)
// ─────────────────────────────────────────────────────────────────────────────

type RawGroup = { id: number; name: string; faculty: string };

const ALL_GROUPS: RawGroup[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'groups.json'), 'utf-8'),
);

/** Mirror of the real fixFacultyName so /group/all and generated data stay in sync. */
function fixFacultyName(faculty: string): string {
  if (faculty.length > 2 && faculty.startsWith('НН') && faculty[2] !== ' ') {
    return 'НН ' + faculty.slice(2);
  }
  return faculty;
}

/** faculty-short → sorted group names[] */
const FACULTY_GROUPS: Record<string, string[]> = {};
/** group name → faculty-short */
const GROUP_FACULTY: Record<string, string> = {};

for (const { faculty: raw, name } of ALL_GROUPS) {
  const fac = fixFacultyName(raw.trim());
  (FACULTY_GROUPS[fac] ??= []).push(name);
  GROUP_FACULTY[name] = fac;
}

for (const key of Object.keys(FACULTY_GROUPS)) {
  FACULTY_GROUPS[key]!.sort((a, b) => a.localeCompare(b, 'uk'));
}

const ALL_FACULTIES = Object.keys(FACULTY_GROUPS).sort((a, b) => a.localeCompare(b, 'uk'));
const ALL_GROUP_NAMES = Object.keys(GROUP_FACULTY);

// ─────────────────────────────────────────────────────────────────────────────
// Seeded deterministic RNG  (xorshift32 – fast, zero deps)
// ─────────────────────────────────────────────────────────────────────────────

function hashStr(s: string): number {
  // FNV-1a 32-bit
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h || 1;
}

function makeRng(seed: number) {
  let s = (seed >>> 0) || 1;
  return (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s = s >>> 0;
    return s / 0x100000000;
  };
}

const pick = <T>(arr: T[], rng: () => number): T =>
  arr[Math.floor(rng() * arr.length)]!;

// ─────────────────────────────────────────────────────────────────────────────
// Ukrainian name corpus
// ─────────────────────────────────────────────────────────────────────────────

const M_FIRST = [
  'Олексій', 'Максим', 'Іван', 'Дмитро', 'Андрій', 'Сергій', 'Михайло', 'Олег',
  'Богдан', 'Ярослав', 'Тарас', 'Василь', 'Роман', 'Денис', 'Владислав', 'Артем',
  'Євген', 'Микола', 'Павло', 'Олександр', 'Кирило', 'Арсен', 'Ігор', 'Руслан', 'Антон',
  'Нікіта', 'Степан', 'Юрій', 'Віктор', 'Леонід',
];
const F_FIRST = [
  'Анна', 'Марія', 'Олена', 'Катерина', 'Наталія', 'Ірина', 'Юлія', 'Вікторія',
  'Тетяна', 'Ольга', 'Дарʼя', 'Людмила', 'Валерія', 'Христина', 'Оксана',
  'Анастасія', 'Карина', 'Поліна', 'Аліна', 'Софія', 'Діана', 'Єлизавета',
  'Яна', 'Ліна', 'Маргарита', 'Злата', 'Аріна', 'Наді', 'Лариса', 'Галина',
];
const LAST = [
  'Шевченко', 'Коваленко', 'Бондаренко', 'Мельник', 'Кравченко', 'Олійник',
  'Шевчук', 'Ковальчук', 'Поліщук', 'Бойко', 'Ткаченко', 'Іваненко', 'Марченко',
  'Гончаренко', 'Мороз', 'Савченко', 'Лисенко', 'Романенко', 'Захаренко', 'Тимченко',
  'Кириленко', 'Руденко', 'Назаренко', 'Пономаренко', 'Гриценко', 'Яременко',
  'Кулик', 'Зінченко', 'Литвиненко', 'Павленко', 'Данченко', 'Харченко', 'Яковенко',
  'Петренко', 'Сидоренко', 'Кузьменко', 'Гавриленко', 'Чорний', 'Білик', 'Король',
  'Клименко', 'Демченко', 'Левченко', 'Олексієнко', 'Найда', 'Скорик', 'Панченко',
];
const M_PAT = [
  'Олексійович', 'Максимович', 'Іванович', 'Дмитрович', 'Андрійович', 'Сергійович',
  'Михайлович', 'Олегович', 'Богданович', 'Ярославович', 'Тарасович', 'Васильович',
  'Романович', 'Денисович', 'Артемович', 'Євгенович', 'Миколайович', 'Павлович',
  'Олександрович', 'Кирилович', 'Ігорович', 'Русланович', 'Антонович', 'Степанович',
  'Юрійович', 'Вікторович', 'Леонідович',
];
const F_PAT = [
  'Олексіївна', 'Максимівна', 'Іванівна', 'Дмитрівна', 'Андріївна', 'Сергіївна',
  'Михайлівна', 'Олегівна', 'Богданівна', 'Ярославівна', 'Тарасівна', 'Василівна',
  'Романівна', 'Денисівна', 'Артемівна', 'Євгенівна', 'Миколаївна', 'Павлівна',
  'Олександрівна', 'Кирилівна', 'Ігорівна', 'Русланівна', 'Антонівна', 'Степанівна',
  'Юріївна', 'Вікторівна', 'Леонідівна',
];

function genName(rng: () => number): string {
  const male = rng() < 0.55;
  const first = pick(male ? M_FIRST : F_FIRST, rng);
  const last = pick(LAST, rng);
  const pat = pick(male ? M_PAT : F_PAT, rng);
  return `${last} ${first} ${pat}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Faculty metadata
// ─────────────────────────────────────────────────────────────────────────────

/** Maps short faculty key → full Ukrainian name returned by the campus API. */
const FACULTY_FULL: Record<string, string> = {
  'ФІОТ': 'Факультет інформатики та обчислювальної техніки',
  'ФЕЛ': 'Факультет електроніки та інформаційних технологій',
  'ФМФ': 'Фізико-математичний факультет',
  'ФБМІ': 'Факультет біомедичної інженерії',
  'ФТІ': 'Фізико-технічний інститут',
  'ХТФ': 'Хіміко-технологічний факультет',
  'ІЕЕ': 'Інститут енергозбереження та енергоменеджменту',
  'ММІ': 'Механіко-машинобудівний інститут',
  'ФМА': 'Факультет менеджменту та маркетингу',
  'ІПСА': 'Інститут прикладного системного аналізу',
  'НН ІАТЕ': 'Навчально-науковий інститут атомної та теплової енергетики',
  'НН ІМЗ': 'Навчально-науковий інститут механіки та машинобудування',
  'НН ІЕССТ': 'Навчально-науковий інститут електроніки та інформаційних технологій',
};

const FACULTY_SPECS: Record<string, string[]> = {
  'ФІОТ': ['121 Інженерія програмного забезпечення', '122 Комп\'ютерні науки', '123 Комп\'ютерна інженерія', '126 Інформаційні системи та технології'],
  'ФЕЛ': ['171 Електроніка', '172 Телекомунікації та радіотехніка', '153 Мікро- та наносистемна техніка'],
  'ФМФ': ['111 Математика', '113 Прикладна математика', '104 Фізика та астрономія'],
  'ФБМІ': ['163 Біомедична інженерія'],
  'ФТІ': ['105 Прикладна фізика та наноматеріали'],
  'ХТФ': ['161 Хімічні технології та інженерія', '162 Біотехнології та біоінженерія'],
  'ІЕЕ': ['141 Електроенергетика, електротехніка та електромеханіка', '143 Атомна енергетика'],
  'ММІ': ['131 Прикладна механіка', '133 Галузеве машинобудування'],
  'ФМА': ['073 Менеджмент', '175 Інформаційно-вимірювальні технології'],
  'ІПСА': ['122 Комп\'ютерні науки', '121 Інженерія програмного забезпечення', '124 Системний аналіз'],
  'НН ІАТЕ': ['143 Атомна енергетика', '105 Прикладна фізика та наноматеріали'],
  'НН ІМЗ': ['131 Прикладна механіка', '133 Галузеве машинобудування'],
  'НН ІЕССТ': ['122 Комп\'ютерні науки', '172 Телекомунікації та радіотехніка', '171 Електроніка'],
};

const DEFAULT_SPECS = ['122 Комп\'ютерні науки', '121 Інженерія програмного забезпечення'];

/**
 * Returns the study year (1–6) encoded in the group name.
 * KPI group format: "ІО-31" → first digit after '-' = 3 = year 3.
 */
function studyYearFromGroup(group: string): number {
  const m = group.match(/-(\d)/);
  const y = m ? parseInt(m[1]!) : 1;
  return Math.min(Math.max(y, 1), 6);
}

const STUDY_FORMS = ['FullTime', 'Evening', 'Remote', 'Correspondence'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Student ID encoding
// ─────────────────────────────────────────────────────────────────────────────
//
//  Dynamic students:   STUDENT_ID = "dyn.<base64url(ticketId)>"
//  Predefined campus:  STUDENT_ID = "pre.<name>"   (e.g. "pre.academic")
//
// Both use only URL-safe characters, so they travel cleanly as path segments.

function tidToStudentId(tid: string): string {
  return 'dyn.' + Buffer.from(tid, 'utf-8').toString('base64url');
}

function studentIdToTid(sid: string): string | null {
  if (!sid.startsWith('dyn.')) return null;
  try {
    return Buffer.from(sid.slice(4), 'base64url').toString('utf-8');
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared types (mirror of src/types/auth.ts – kept local to avoid imports)
// ─────────────────────────────────────────────────────────────────────────────

interface KpiIdUserInfo {
  EMPLOYEE_ID: string;
  AUTH_METHOD: string;
  STUDENT_ID: string;
  TAX_ID: string;
  NAME: string;
  TRACE_ID: string;
  TIME_STAMP: string;
}

interface CampusUserInfo {
  groupName: string;
  faculty: string;
  status: 'Studying' | 'OnAcademicLeave' | 'Dismissed';
  studyForm: string;
  studyYear: number;
  speciality: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ticket parsing
// ─────────────────────────────────────────────────────────────────────────────

type DynTicket = { kind: 'dynamic'; n: number; faculty?: string; group?: string };
type PreTicket = { kind: 'predefined'; id: string };
type ParsedTicket = DynTicket | PreTicket;

const PREDEFINED_IDS = new Set([
  'employee', 'both', 'no-diia', 'invalid', 'academic', 'dismissed',
]);

function parseTicket(tid: string): ParsedTicket {
  if (PREDEFINED_IDS.has(tid)) return { kind: 'predefined', id: tid };

  // Dynamic: s{N} or s{N}@{scope}
  const m = tid.match(/^s(\d{1,3})(?:@(.+))?$/);
  if (!m) {
    // Unknown ticket – surface as "invalid" so callers get a clear error path
    console.warn(`[mock] Unknown ticket "${tid}", treating as invalid`);
    return { kind: 'predefined', id: 'invalid' };
  }

  const n = Math.max(1, Math.min(100, parseInt(m[1]!)));
  const scope = m[2];

  if (!scope) return { kind: 'dynamic', n };

  // Scope resolution: group names take precedence over faculty names
  if (GROUP_FACULTY[scope]) return { kind: 'dynamic', n, group: scope };
  if (FACULTY_GROUPS[scope]) return { kind: 'dynamic', n, faculty: scope };

  // Unknown scope – warn and fall back to unconstrained student
  console.warn(`[mock] Unknown faculty/group scope "${scope}" in ticket "${tid}", ignoring scope`);
  return { kind: 'dynamic', n };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic student generator
// ─────────────────────────────────────────────────────────────────────────────

function generateDynStudent(
  tid: string,
  parsed: DynTicket,
): { kpiId: KpiIdUserInfo; campus: CampusUserInfo } {
  const rng = makeRng(hashStr(tid));

  // ── Resolve group & faculty ───────────────────────────────────────────────
  let group: string;
  let faculty: string;

  if (parsed.group) {
    group = parsed.group;
    faculty = GROUP_FACULTY[group] ?? pick(ALL_FACULTIES, rng);
  } else {
    const candidates = parsed.faculty
      ? (FACULTY_GROUPS[parsed.faculty] ?? ALL_GROUP_NAMES)
      : ALL_GROUP_NAMES;
    group = pick(candidates, rng);
    faculty = GROUP_FACULTY[group] ?? parsed.faculty ?? pick(ALL_FACULTIES, rng);
  }

  // ── Generate the rest deterministically from the same rng ────────────────
  const specs = FACULTY_SPECS[faculty] ?? DEFAULT_SPECS;
  const speciality = pick(specs, rng);
  const studyForm = pick(STUDY_FORMS as unknown as string[], rng);
  const name = genName(rng);
  const taxId = String(hashStr(tid + '|tax') % 9_000_000_000 + 1_000_000_000);
  const studentId = tidToStudentId(tid);
  const facultyFull = FACULTY_FULL[faculty] ?? faculty;

  return {
    kpiId: {
      EMPLOYEE_ID: '',
      AUTH_METHOD: 'DIIA',
      STUDENT_ID: studentId,
      TAX_ID: taxId,
      NAME: name,
      TRACE_ID: `trace-${studentId}`,
      TIME_STAMP: '2024-09-01T08:00:00.000Z',
    },
    campus: {
      groupName: group,
      faculty: facultyFull,
      status: 'Studying',
      studyForm,
      studyYear: studyYearFromGroup(group),
      speciality,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Predefined users
// ─────────────────────────────────────────────────────────────────────────────

const PREDEFINED_KPIID: Record<string, KpiIdUserInfo> = {
  /** No STUDENT_ID → resolveTicket throws NotStudentError */
  employee: {
    EMPLOYEE_ID: 'EMP-001',
    STUDENT_ID: '',
    AUTH_METHOD: 'DIIA',
    TAX_ID: '1234567890',
    NAME: 'Петров Іван Сергійович',
    TRACE_ID: 'trace-employee',
    TIME_STAMP: '2024-09-01T08:00:00.000Z',
  },

  /** Both IDs set → passes resolveTicket, reaches campus API as a student */
  both: {
    EMPLOYEE_ID: 'EMP-002',
    STUDENT_ID: 'pre.both',
    AUTH_METHOD: 'DIIA',
    TAX_ID: '0987654321',
    NAME: 'Сидоренко Марія Іванівна',
    TRACE_ID: 'trace-both',
    TIME_STAMP: '2024-09-01T08:00:00.000Z',
  },

  /** Wrong auth method → resolveTicket throws NotDiiaAuthError */
  'no-diia': {
    EMPLOYEE_ID: '',
    STUDENT_ID: 'pre.nodiia',
    AUTH_METHOD: 'BANK_ID',
    TAX_ID: '1111111111',
    NAME: 'Іваненко Олег Петрович',
    TRACE_ID: 'trace-nodiia',
    TIME_STAMP: '2024-09-01T08:00:00.000Z',
  },

  /** No STUDENT_ID and no EMPLOYEE_ID → resolveTicket throws InvalidUserDataError */
  invalid: {
    EMPLOYEE_ID: '',
    STUDENT_ID: '',
    AUTH_METHOD: 'DIIA',
    TAX_ID: '2222222222',
    NAME: '',
    TRACE_ID: 'trace-invalid',
    TIME_STAMP: '2024-09-01T08:00:00.000Z',
  },

  /** Valid ticket but campus returns OnAcademicLeave → NotStudyingError */
  academic: {
    EMPLOYEE_ID: '',
    STUDENT_ID: 'pre.academic',
    AUTH_METHOD: 'DIIA',
    TAX_ID: '3333333333',
    NAME: 'Гончаренко Тетяна Василівна',
    TRACE_ID: 'trace-academic',
    TIME_STAMP: '2024-09-01T08:00:00.000Z',
  },

  /** Valid ticket but campus returns Dismissed → NotStudyingError */
  dismissed: {
    EMPLOYEE_ID: '',
    STUDENT_ID: 'pre.dismissed',
    AUTH_METHOD: 'DIIA',
    TAX_ID: '4444444444',
    NAME: 'Мороз Дмитро Андрійович',
    TRACE_ID: 'trace-dismissed',
    TIME_STAMP: '2024-09-01T08:00:00.000Z',
  },
};

/** Campus data for predefined STUDENT_IDs (keyed by the pre.* student ID). */
const PREDEFINED_CAMPUS: Record<string, CampusUserInfo> = {
  'pre.both': {
    groupName: 'ІО-41',
    faculty: FACULTY_FULL['ФІОТ']!,
    status: 'Studying',
    studyForm: 'FullTime',
    studyYear: 4,
    speciality: '121 Інженерія програмного забезпечення',
  },
  'pre.academic': {
    groupName: 'КА-31',
    faculty: FACULTY_FULL['ІПСА']!,
    status: 'OnAcademicLeave',
    studyForm: 'FullTime',
    studyYear: 3,
    speciality: '122 Комп\'ютерні науки',
  },
  'pre.dismissed': {
    groupName: 'ДА-32',
    faculty: FACULTY_FULL['ФЕЛ']!,
    status: 'Dismissed',
    studyForm: 'FullTime',
    studyYear: 2,
    speciality: '171 Електроніка',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

const send404 = (res: http.ServerResponse) => json(res, 404, { error: 'Not Found' });
const send400 = (res: http.ServerResponse, msg: string) => json(res, 400, { error: msg });

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

/** GET /group/all – return the raw groups array (same file, fixFacultyName not applied here
 *  intentionally, so the real app's ingest logic is exercised end-to-end). */
function handleGroupAll(_req: http.IncomingMessage, res: http.ServerResponse): void {
  json(res, 200, ALL_GROUPS);
}

/** GET /api/ticket?ticketId=&appId=&appSecret= */
function handleTicket(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url!, 'http://localhost');
  const ticketId = url.searchParams.get('ticketId') ?? '';

  if (!ticketId) return send400(res, 'Missing ticketId query parameter');

  const parsed = parseTicket(ticketId);

  if (parsed.kind === 'predefined') {
    const kpiId = PREDEFINED_KPIID[parsed.id];
    // Unknown predefined id (shouldn't happen after parseTicket) → treat as invalid ticket
    if (!kpiId) return json(res, 400, { error: 'Invalid or expired ticketId' });
    return json(res, 200, { data: kpiId });
  }

  // Dynamic
  const { kpiId } = generateDynStudent(ticketId, parsed);
  return json(res, 200, { data: kpiId });
}

/** GET /api/integration/voteoss/students/:STUDENT_ID */
function handleCampusStudent(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  studentId: string,
): void {
  // Predefined campus user?
  const preData = PREDEFINED_CAMPUS[studentId];
  if (preData) return json(res, 200, preData);

  // Dynamic student?
  const tid = studentIdToTid(studentId);
  if (!tid) return send404(res);

  const parsed = parseTicket(tid);
  if (parsed.kind === 'predefined') return send404(res);

  const { campus } = generateDynStudent(tid, parsed);
  return json(res, 200, campus);
}

/** GET /students – human-readable cheat sheet */
function handleStudents(_req: http.IncomingMessage, res: http.ServerResponse): void {
  // Build a few quick example dynamic students for illustration
  const exampleTickets = ['s1', 's2', 's3'];
  const examples = exampleTickets.map((tid) => {
    const parsed = parseTicket(tid) as DynTicket;
    const { kpiId, campus } = generateDynStudent(tid, parsed);
    return { ticketId: tid, studentId: kpiId.STUDENT_ID, name: kpiId.NAME, group: campus.groupName, faculty: campus.faculty };
  });

  json(res, 200, {
    predefined: [
      { ticketId: 'employee', trigger: 'NotStudentError', note: 'EMPLOYEE_ID set, STUDENT_ID empty' },
      { ticketId: 'both', trigger: '(valid student)', note: 'Both EMPLOYEE_ID and STUDENT_ID set; treated as student' },
      { ticketId: 'no-diia', trigger: 'NotDiiaAuthError', note: 'AUTH_METHOD = BANK_ID instead of DIIA' },
      { ticketId: 'invalid', trigger: 'InvalidUserDataError', note: 'STUDENT_ID and NAME are empty strings' },
      { ticketId: 'academic', trigger: 'NotStudyingError', note: 'Campus status = OnAcademicLeave' },
      { ticketId: 'dismissed', trigger: 'NotStudyingError', note: 'Campus status = Dismissed' },
    ],
    dynamic: {
      formats: [
        's{N}            →  any group/faculty  (N = 1 … 100)',
        's{N}@{faculty}  →  group from the given faculty',
        's{N}@{group}    →  that exact group',
      ],
      guarantee: 'Same ticketId ⟹ identical data on every request (hash-seeded, stateless).',
      faculties: ALL_FACULTIES,
      groupsByFaculty: FACULTY_GROUPS,
      quickExamples: [
        ...ALL_FACULTIES.slice(0, 4).map((f, i) => `s${i + 1}@${f}`),
        ...ALL_GROUP_NAMES.slice(0, 4).map((g, i) => `s${i + 10}@${g}`),
      ],
      previewStudents: examples,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');

  // CORS – allow any localhost origin for dev convenience
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method Not Allowed' });
  }

  // ── Routes ────────────────────────────────────────────────────────────────

  if (pathname === '/group/all') {
    return handleGroupAll(req, res);
  }

  if (pathname === '/api/ticket') {
    return handleTicket(req, res);
  }

  const campusMatch = pathname.match(/^\/api\/integration\/voteoss\/students\/(.+)$/);
  if (campusMatch) {
    return handleCampusStudent(req, res, decodeURIComponent(campusMatch[1]!));
  }

  if (pathname === '/students') {
    return handleStudents(req, res);
  }

  return send404(res);
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`\n🎓  Mock KPI API  →  ${base}\n`);
  console.log('  Routes:');
  console.log(`    GET  ${base}/group/all`);
  console.log(`    GET  ${base}/api/ticket?ticketId=s1&appId=x&appSecret=y`);
  console.log(`    GET  ${base}/api/integration/voteoss/students/:STUDENT_ID`);
  console.log(`    GET  ${base}/students`);
  console.log('');
  console.log('  Quick examples:');
  console.log(`    curl "${base}/api/ticket?ticketId=s1"`);
  console.log(`    curl "${base}/api/ticket?ticketId=s1@ФІОТ"`);
  console.log(`    curl "${base}/api/ticket?ticketId=s7@КА-31"`);
  console.log(`    curl "${base}/api/ticket?ticketId=academic"`);
  console.log(`    curl "${base}/students"   # full cheat-sheet\n`);
});
