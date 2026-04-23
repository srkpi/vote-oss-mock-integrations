# Vote OSS mock integrations API

Lightweight local mock for the Campus and KPI ID APIs.
Zero runtime dependencies — only Node.js built-ins + `tsx` to run TypeScript.

## Setup

```bash
cd mock-api
npm install        # installs tsx (dev-only)
npm run dev        # starts on :3001 with file-watch restart
# or
npm start          # one-shot start
# or
PORT=4000 npm start
```

Point your app's env vars at `http://localhost:3001` (or whichever port you chose):

```env
CAMPUS_API_URL=http://localhost:3001
KPI_AUTH_URL=http://localhost:3001
```

---

## Endpoints

| Method | Path                                      | Description                                |
| ------ | ----------------------------------------- | ------------------------------------------ |
| GET    | `/group/all`                            | Full groups array (groups.json)            |
| GET    | `/api/ticket`                           | KPI-ID ticket exchange                     |
| GET    | `/api/integration/voteoss/students/:id` | Campus student data                        |
| GET    | `/students`                             | Cheat sheet — all tickets + live previews |

---

## Ticket IDs

### Dynamic students — `s{N}` or `s{N}@{scope}`

The same ticket ID **always returns the same student** (hash-seeded, no state).

| Ticket          | Resolves to                           |
| --------------- | ------------------------------------- |
| `s1`          | Any group, any faculty                |
| `s42`         | Same as above, different student      |
| `s1@ФІОТ` | Student whose group is in ФІОТ    |
| `s7@КА-31`  | Student in group КА-31 specifically |
| `s3@ФЕЛ`   | Student whose group is in ФЕЛ      |

`N` can be 1–100. Scopes can be any **faculty short name** or **group name** from groups.json.

### Predefined tickets — fixed edge cases

| Ticket        | Error triggered          | What's special                              |
| ------------- | ------------------------ | ------------------------------------------- |
| `employee`  | `NotStudentError`      | `EMPLOYEE_ID` set, `STUDENT_ID` empty   |
| `both`      | *(valid student)*      | Both `EMPLOYEE_ID` and `STUDENT_ID` set |
| `no-diia`   | `NotDiiaAuthError`     | `AUTH_METHOD = BANK_ID`                   |
| `invalid`   | `InvalidUserDataError` | `STUDENT_ID` and `NAME` are empty       |
| `academic`  | `NotStudyingError`     | Campus returns `OnAcademicLeave`          |
| `dismissed` | `NotStudyingError`     | Campus returns `Dismissed`                |

---

## Quick copy-paste

```bash
BASE=http://localhost:3001

# Regular students
curl "$BASE/api/ticket?ticketId=s1&appId=x&appSecret=y"
curl "$BASE/api/ticket?ticketId=s1@ФІОТ&appId=x&appSecret=y"
curl "$BASE/api/ticket?ticketId=s7@КА-31&appId=x&appSecret=y"

# Edge cases
curl "$BASE/api/ticket?ticketId=employee&appId=x&appSecret=y"
curl "$BASE/api/ticket?ticketId=academic&appId=x&appSecret=y"
curl "$BASE/api/ticket?ticketId=dismissed&appId=x&appSecret=y"

# Full cheat-sheet with all faculties/groups
curl "$BASE/students" | jq .
```
