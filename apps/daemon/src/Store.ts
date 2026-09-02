import type {
  ChatAttachment,
  ChatMessage,
  HomeworkInput,
  HomeworkItem,
  HomeworkKind,
  HomeworkSource,
  HomeworkType,
  Lesson,
  PlanItem,
  PlanItemInput,
  Prompt,
  PromptAnswer,
  PromptKind,
  RosterChange,
  Settings,
  Signal,
  Vacation,
  WeekData
} from "@school-buddy/shared"
import { defaultSettings, Settings as SettingsSchema } from "@school-buddy/shared"
import * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { addDays, dayStartInstant, today, weekBoundsOf } from "@school-buddy/shared"
import { diffLessons } from "./rosterDiff.ts"

export interface StoreShape {
  readonly replaceLessons: (
    lessons: ReadonlyArray<Lesson>,
    fromDate: string,
    toDateExclusive: string
  ) => Effect.Effect<void>
  /**
   * Diff the fetched lessons against the stored ones (dates already synced
   * before, not in the past), log the differences, then replace the window.
   */
  readonly reconcileLessons: (
    lessons: ReadonlyArray<Lesson>,
    fromDate: string,
    toDateExclusive: string
  ) => Effect.Effect<Array<RosterChange>>
  readonly recentChanges: (limit: number) => Effect.Effect<Array<RosterChange>>
  readonly unnotifiedChanges: (untilDateExclusive: string) => Effect.Effect<Array<RosterChange>>
  readonly markChangesNotified: (ids: ReadonlyArray<string>) => Effect.Effect<void>
  readonly replaceTeachers: (
    teachers: ReadonlyArray<{ readonly abbrev: string; readonly name: string }>
  ) => Effect.Effect<void>
  readonly replaceVacations: (vacations: ReadonlyArray<Vacation>) => Effect.Effect<void>
  /** vacations overlapping [fromDay, toDayExclusive) */
  readonly vacationsBetween: (fromDay: string, toDayExclusive: string) => Effect.Effect<Array<Vacation>>
  readonly weekData: (date: string) => Effect.Effect<WeekData>
  readonly lessonsEndedBetween: (fromIso: string, toIso: string) => Effect.Effect<Array<Lesson>>
  readonly nextLessonForSubject: (
    subject: string,
    afterIso: string
  ) => Effect.Effect<Lesson | null>
  readonly getPrompt: (id: string) => Effect.Effect<Prompt | null>
  readonly createHomework: (
    input: HomeworkInput,
    source: HomeworkSource
  ) => Effect.Effect<HomeworkItem>
  readonly upsertSomtodayHomework: (items: ReadonlyArray<HomeworkItem>) => Effect.Effect<void>
  readonly getHomework: (id: string) => Effect.Effect<HomeworkItem | null>
  /** self-entered + Somtoday items that may describe the same assignment, not judged yet */
  readonly dedupCandidates: Effect.Effect<Array<{ self: HomeworkItem; somtoday: HomeworkItem }>>
  readonly recordDedupVerdict: (
    selfId: string,
    somtodayId: string,
    verdict: "same" | "different" | "asked"
  ) => Effect.Effect<void>
  /** keep the Somtoday item (inheriting done), soft-delete the self-entered one */
  readonly mergeHomework: (selfId: string, somtodayId: string) => Effect.Effect<boolean>
  readonly setHomeworkDone: (id: string, done: boolean) => Effect.Effect<boolean>
  /** soft delete, so Somtoday-sourced items don't come back on the next sync */
  readonly deleteHomework: (id: string) => Effect.Effect<boolean>
  /** not-done, not-deleted homework due in [fromDate, toDateExclusive), oldest first */
  readonly openHomework: (fromDate: string, toDateExclusive: string) => Effect.Effect<Array<HomeworkItem>>
  readonly hasHomeworkForLesson: (lessonId: string) => Effect.Effect<boolean>
  readonly pendingPrompts: Effect.Effect<Array<Prompt>>
  readonly createPrompt: (options: {
    readonly kind: PromptKind
    readonly text: string
    readonly lessonId?: string | null
    readonly subject?: string | null
  }) => Effect.Effect<Prompt>
  readonly hasPromptForLesson: (lessonId: string) => Effect.Effect<boolean>
  readonly answerPrompt: (answer: PromptAnswer) => Effect.Effect<boolean>
  readonly recordSignal: (signal: Signal) => Effect.Effect<void>
  readonly getMeta: (key: string) => Effect.Effect<string | null>
  readonly setMeta: (key: string, value: string) => Effect.Effect<void>
  readonly addChatMessage: (
    role: ChatMessage["role"],
    content: string,
    attachments?: ReadonlyArray<ChatAttachment>
  ) => Effect.Effect<ChatMessage>
  /** most recent messages for display, oldest first */
  readonly recentChatMessages: (limit: number) => Effect.Effect<Array<ChatMessage>>
  /** messages not yet folded into the rolling summary, oldest first */
  readonly uncompactedChatMessages: Effect.Effect<Array<ChatMessage>>
  readonly markChatCompacted: (beforeIso: string) => Effect.Effect<void>
  // --- planning ---
  readonly planItemsBetween: (fromDate: string, toDateExclusive: string) => Effect.Effect<Array<PlanItem>>
  readonly planItemsForHomework: (homeworkId: string) => Effect.Effect<Array<PlanItem>>
  /** replaces any existing plan for the homework */
  readonly setPlan: (homeworkId: string, items: ReadonlyArray<PlanItemInput>) => Effect.Effect<Array<PlanItem>>
  readonly setPlanItemDone: (id: string, done: boolean) => Effect.Effect<boolean>
  readonly movePlanItem: (id: string, day: string) => Effect.Effect<boolean>
  readonly setHomeworkKind: (id: string, kind: HomeworkKind) => Effect.Effect<void>
  /** change subject / due date / description; null = leave as-is */
  readonly updateHomework: (id: string, fields: {
    readonly subject?: string | null
    readonly dueDate?: string | null
    readonly description?: string | null
  }) => Effect.Effect<HomeworkItem | null>
  /** drop the plan + planning status so the item gets planned again */
  readonly clearPlanning: (homeworkId: string) => Effect.Effect<void>
  /** homework whose kind hasn't been decided yet (open, not deleted) */
  readonly unclassifiedHomework: Effect.Effect<Array<HomeworkItem>>
  readonly setPlanningStatus: (homeworkId: string, status: "planned" | "asked" | "skipped") => Effect.Effect<void>
  /** open, not-deleted homework due on/after fromDate without a planning status */
  readonly unplannedHomework: (fromDate: string) => Effect.Effect<Array<HomeworkItem>>
  /** lessons + already planned minutes per day, for spreading work sensibly */
  readonly dayLoads: (fromDate: string, toDateExclusive: string) => Effect.Effect<Array<{ day: string; lessons: number; plannedMinutes: number }>>
  readonly getSettings: Effect.Effect<Settings>
  readonly setSettings: (settings: Settings) => Effect.Effect<Settings>
}

export class Store extends Context.Service<Store, StoreShape>()("app/Store") {}

const migrations = [
  `create table if not exists lessons (
    id text primary key,
    subject text not null,
    title text not null,
    location text,
    teacher text,
    start text not null,
    end text not null,
    cancelled integer not null default 0,
    period_start integer,
    period_end integer
  )`,
  // added later; ignored when the column already exists (see migrate loop)
  `alter table lessons add column period_start integer`,
  // Instants are stored in UTC. Rows written by older versions kept local
  // time with an offset ("...+02:00"), which cannot be compared with UTC
  // markers, so they are converted in place once.
  `update lessons set start = strftime('%Y-%m-%dT%H:%M:%S.000Z', start),
                      end = strftime('%Y-%m-%dT%H:%M:%S.000Z', end)
     where start not like '%Z'`,
  `alter table lessons add column period_end integer`,
  `create table if not exists homework (
    id text primary key,
    subject text not null,
    due_date text not null,
    description text not null,
    source text not null,
    lesson_id text,
    done integer not null default 0,
    created_at text not null
  )`,
  `create table if not exists prompts (
    id text primary key,
    kind text not null,
    text text not null,
    lesson_id text,
    subject text,
    status text not null default 'pending',
    answer text,
    created_at text not null
  )`,
  `create table if not exists signals (
    kind text not null,
    at text not null
  )`,
  `create table if not exists teachers (
    abbrev text primary key,
    name text not null
  )`,
  `create table if not exists vacations (
    id text primary key,
    name text not null,
    start_day text not null,
    end_day text not null
  )`,
  `create table if not exists meta (
    key text primary key,
    value text not null
  )`,
  `alter table homework add column deleted integer not null default 0`,
  `alter table homework add column kind text not null default 'unknown'`,
  `alter table homework add column hw_type text not null default 'overig'`,
  `alter table homework add column subject_name text`,
  `alter table homework add column title text`,
  // LESSTOF is lesson material, not an assignment: classify it as info and
  // drop sessions an earlier version planned for it
  `delete from plan_items where homework_id in
     (select id from homework where hw_type = 'lesstof' and kind in ('unknown', 'task'))`,
  `insert into homework_planning (homework_id, status, at)
     select id, 'skipped', datetime('now') from homework
     where hw_type = 'lesstof' and kind in ('unknown', 'task')
     on conflict(homework_id) do update set status = 'skipped'`,
  `update homework set kind = 'info' where hw_type = 'lesstof' and kind in ('unknown', 'task')`,
  `create table if not exists plan_items (
    id text primary key,
    homework_id text not null,
    day text not null,
    duration_minutes integer not null,
    title text not null,
    done integer not null default 0,
    created_at text not null
  )`,
  `create table if not exists homework_planning (
    homework_id text primary key,
    status text not null,
    at text not null
  )`,
  `create table if not exists homework_dedup (
    self_id text not null,
    somtoday_id text not null,
    verdict text not null,
    at text not null,
    primary key (self_id, somtoday_id)
  )`,
  `create table if not exists chat_messages (
    id text primary key,
    role text not null,
    content text not null,
    created_at text not null,
    compacted integer not null default 0
  )`,
  `alter table chat_messages add column attachments text`,
  `create table if not exists roster_changes (
    id text primary key,
    detected_at text not null,
    kind text not null,
    date text not null,
    subject text,
    lesson_id text,
    summary text not null,
    before_json text,
    after_json text,
    notified integer not null default 0
  )`
]

interface ChatMessageRow {
  readonly id: string
  readonly role: string
  readonly content: string
  readonly created_at: string
  readonly attachments: string | null
}

const chatMessageFromRow = (row: ChatMessageRow): ChatMessage => {
  let attachments: Array<ChatAttachment> = []
  try {
    if (row.attachments !== null) attachments = JSON.parse(row.attachments) as Array<ChatAttachment>
  } catch {
    attachments = []
  }
  return {
    id: row.id,
    role: row.role as ChatMessage["role"],
    content: row.content,
    createdAt: row.created_at,
    attachments
  }
}

interface VacationRow {
  readonly id: string
  readonly name: string
  readonly start_day: string
  readonly end_day: string
}

const vacationFromRow = (row: VacationRow): Vacation => ({
  id: row.id,
  name: row.name,
  startDay: row.start_day,
  endDay: row.end_day
})

interface PlanItemRow {
  readonly id: string
  readonly homework_id: string
  readonly subject: string
  readonly subject_name: string | null
  readonly description: string
  readonly due_date: string
  readonly day: string
  readonly duration_minutes: number
  readonly title: string
  readonly done: number
  readonly created_at: string
}

const planItemFromRow = (row: PlanItemRow): PlanItem => ({
  id: row.id,
  homeworkId: row.homework_id,
  subject: row.subject,
  subjectName: row.subject_name ?? row.subject,
  homeworkDescription: row.description,
  dueDate: row.due_date,
  day: row.day,
  durationMinutes: row.duration_minutes,
  title: row.title,
  done: row.done === 1,
  createdAt: row.created_at
})

interface RosterChangeRow {
  readonly id: string
  readonly detected_at: string
  readonly kind: string
  readonly date: string
  readonly subject: string | null
  readonly lesson_id: string | null
  readonly summary: string
  readonly before_json: string | null
  readonly after_json: string | null
  readonly notified: number
}

const rosterChangeFromRow = (row: RosterChangeRow): RosterChange => ({
  id: row.id,
  detectedAt: row.detected_at,
  kind: row.kind as RosterChange["kind"],
  date: row.date,
  subject: row.subject,
  lessonId: row.lesson_id,
  summary: row.summary,
  before: row.before_json === null ? null : (JSON.parse(row.before_json) as Lesson),
  after: row.after_json === null ? null : (JSON.parse(row.after_json) as Lesson),
  notified: row.notified === 1
})

interface LessonRow {
  readonly id: string
  readonly subject: string
  readonly title: string
  readonly location: string | null
  readonly teacher: string | null
  readonly start: string
  readonly end: string
  readonly cancelled: number
  readonly period_start: number | null
  readonly period_end: number | null
}

interface HomeworkRow {
  readonly id: string
  readonly subject: string
  readonly due_date: string
  readonly description: string
  readonly source: string
  readonly lesson_id: string | null
  readonly done: number
  readonly created_at: string
  readonly kind: string | null
  readonly hw_type: string | null
  readonly subject_name: string | null
  readonly title: string | null
}

interface PromptRow {
  readonly id: string
  readonly kind: string
  readonly text: string
  readonly lesson_id: string | null
  readonly subject: string | null
  readonly status: string
  readonly answer: string | null
  readonly created_at: string
}

const lessonFromRow = (row: LessonRow, teachers?: ReadonlyMap<string, string>): Lesson => ({
  id: row.id,
  subject: row.subject,
  title: row.title,
  location: row.location,
  teacher: row.teacher,
  teacherName: resolveTeachers(row.teacher, teachers),
  start: row.start,
  end: row.end,
  cancelled: row.cancelled === 1,
  periodStart: row.period_start,
  periodEnd: row.period_end
})

/** "dij61, grc01" -> "Daan Dijk, Guus Grc" when the directory knows them */
const resolveTeachers = (
  abbrevs: string | null,
  teachers?: ReadonlyMap<string, string>
): string | null => {
  if (abbrevs === null || teachers === undefined) return null
  const names = abbrevs
    .split(/[,;]/)
    .map((a) => teachers.get(a.trim().toLowerCase()))
    .filter((n): n is string => n !== undefined)
  return names.length === 0 ? null : [...new Set(names)].join(", ")
}

const homeworkFromRow = (row: HomeworkRow): HomeworkItem => ({
  id: row.id,
  subject: row.subject,
  subjectName: row.subject_name ?? row.subject,
  title: row.title,
  dueDate: row.due_date,
  description: row.description,
  source: row.source as HomeworkItem["source"],
  lessonId: row.lesson_id,
  done: row.done === 1,
  createdAt: row.created_at,
  kind: (row.kind ?? "unknown") as HomeworkKind,
  type: (row.hw_type ?? "overig") as HomeworkType
})

const promptFromRow = (row: PromptRow): Prompt => ({
  id: row.id,
  kind: row.kind as Prompt["kind"],
  text: row.text,
  lessonId: row.lesson_id,
  subject: row.subject,
  status: row.status as Prompt["status"],
  answer: row.answer,
  createdAt: row.created_at
})

const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient

  for (const migration of migrations) {
    // "alter table add column" fails harmlessly when the column already exists
    yield* sql.unsafe(migration).pipe(
      migration.startsWith("alter table") ? Effect.ignore : Effect.orDie
    )
  }

  const store: StoreShape = {
    replaceLessons: (lessons, fromDate, toDateExclusive) =>
      Effect.gen(function* () {
        const from = dayStartInstant(fromDate)
        const to = dayStartInstant(toDateExclusive)
        yield* sql`delete from lessons where start >= ${from} and start < ${to}`
        for (const l of lessons) {
          yield* sql`insert or replace into lessons
            (id, subject, title, location, teacher, start, end, cancelled, period_start, period_end)
            values (${l.id}, ${l.subject}, ${l.title}, ${l.location}, ${l.teacher},
                    ${l.start}, ${l.end}, ${l.cancelled ? 1 : 0}, ${l.periodStart}, ${l.periodEnd})`
        }
      }).pipe(Effect.orDie),

    reconcileLessons: (lessons, fromDate, toDateExclusive) =>
      Effect.gen(function* () {
        const syncedUntil = yield* store.getMeta("roster.syncedUntil")
        const detected: Array<RosterChange> = []
        // first sync ever: just seed the baseline, nothing to compare against
        if (syncedUntil !== null) {
          const rows = yield* sql<LessonRow>`
            select * from lessons
            where start >= ${dayStartInstant(fromDate)} and start < ${dayStartInstant(toDateExclusive)}`
          const currentDay = today()
          const changes = diffLessons(rows.map((row) => lessonFromRow(row)), lessons, {
            from: currentDay > fromDate ? currentDay : fromDate,
            until: syncedUntil < toDateExclusive ? syncedUntil : toDateExclusive
          })
          const now = new Date().toISOString()
          for (const c of changes) {
            const change: RosterChange = { ...c, id: crypto.randomUUID(), detectedAt: now, notified: false }
            yield* sql`insert into roster_changes
              (id, detected_at, kind, date, subject, lesson_id, summary, before_json, after_json, notified)
              values (${change.id}, ${change.detectedAt}, ${change.kind}, ${change.date}, ${change.subject},
                      ${change.lessonId}, ${change.summary},
                      ${change.before === null ? null : JSON.stringify(change.before)},
                      ${change.after === null ? null : JSON.stringify(change.after)}, 0)`
            detected.push(change)
          }
        }
        yield* store.replaceLessons(lessons, fromDate, toDateExclusive)
        const newUntil = syncedUntil !== null && syncedUntil > toDateExclusive ? syncedUntil : toDateExclusive
        yield* store.setMeta("roster.syncedUntil", newUntil)
        return detected
      }).pipe(Effect.orDie),

    recentChanges: (limit) =>
      sql<RosterChangeRow>`
        select * from roster_changes order by detected_at desc, date asc limit ${limit}`.pipe(
        Effect.map((rows) => rows.map(rosterChangeFromRow)),
        Effect.orDie
      ),

    unnotifiedChanges: (untilDateExclusive) =>
      sql<RosterChangeRow>`
        select * from roster_changes
        where notified = 0 and kind != 'published' and date < ${untilDateExclusive}
        order by date asc`.pipe(
        Effect.map((rows) => rows.map(rosterChangeFromRow)),
        Effect.orDie
      ),

    markChangesNotified: (ids) =>
      Effect.gen(function* () {
        for (const id of ids) {
          yield* sql`update roster_changes set notified = 1 where id = ${id}`
        }
      }).pipe(Effect.orDie),

    replaceTeachers: (teachers) =>
      Effect.gen(function* () {
        for (const t of teachers) {
          yield* sql`insert into teachers (abbrev, name) values (${t.abbrev.toLowerCase()}, ${t.name})
            on conflict(abbrev) do update set name = excluded.name`
        }
      }).pipe(Effect.orDie),

    replaceVacations: (vacations) =>
      Effect.gen(function* () {
        yield* sql`delete from vacations`
        for (const v of vacations) {
          yield* sql`insert into vacations (id, name, start_day, end_day)
            values (${v.id}, ${v.name}, ${v.startDay}, ${v.endDay})`
        }
      }).pipe(Effect.orDie),

    vacationsBetween: (fromDay, toDayExclusive) =>
      sql<VacationRow>`
        select * from vacations
        where start_day < ${toDayExclusive} and end_day >= ${fromDay}
        order by start_day asc`.pipe(
        Effect.map((rows) => rows.map(vacationFromRow)),
        Effect.orDie
      ),

    weekData: (date) =>
      Effect.gen(function* () {
        const bounds = weekBoundsOf(date)
        // the week runs from local midnight to local midnight
        const fromInstant = dayStartInstant(bounds.monday)
        const toInstant = dayStartInstant(bounds.nextMonday)
        const lessonRows = yield* sql<LessonRow>`
          select * from lessons
          where start >= ${fromInstant} and start < ${toInstant}
          order by start asc`
        const homeworkRows = yield* sql<HomeworkRow>`
          select * from homework
          where due_date >= ${bounds.monday} and due_date < ${bounds.nextMonday} and deleted = 0
          order by due_date asc, subject asc`
        const teacherRows = yield* sql<{ readonly abbrev: string; readonly name: string }>`
          select abbrev, name from teachers`
        const teachers = new Map(teacherRows.map((t) => [t.abbrev, t.name] as const))
        const vacations = yield* store.vacationsBetween(bounds.monday, bounds.nextMonday)
        return {
          year: bounds.year,
          week: bounds.week,
          monday: bounds.monday,
          lessons: lessonRows.map((row) => lessonFromRow(row, teachers)),
          homework: homeworkRows.map(homeworkFromRow),
          vacations
        } satisfies WeekData
      }).pipe(Effect.orDie),

    lessonsEndedBetween: (fromIso, toIso) =>
      sql<LessonRow>`
        select * from lessons
        where end > ${fromIso} and end <= ${toIso} and cancelled = 0
        order by end asc`.pipe(
        Effect.map((rows) => rows.map((row) => lessonFromRow(row))),
        Effect.orDie
      ),

    nextLessonForSubject: (subject, afterIso) =>
      sql<LessonRow>`
        select * from lessons
        where subject = ${subject} and start > ${afterIso} and cancelled = 0
        order by start asc limit 1`.pipe(
        Effect.map((rows) => (rows[0] ? lessonFromRow(rows[0]) : null)),
        Effect.orDie
      ),

    getPrompt: (id) =>
      sql<PromptRow>`select * from prompts where id = ${id}`.pipe(
        Effect.map((rows) => (rows[0] ? promptFromRow(rows[0]) : null)),
        Effect.orDie
      ),

    createHomework: (input, source) =>
      Effect.gen(function* () {
        const item: HomeworkItem = {
          id: crypto.randomUUID(),
          subject: input.subject,
          subjectName: input.subject,
          title: null,
          dueDate: input.dueDate,
          description: input.description,
          source,
          lessonId: input.lessonId,
          done: false,
          createdAt: new Date().toISOString(),
          kind: "unknown",
          type: "overig"
        }
        yield* sql`insert into homework
          (id, subject, subject_name, title, due_date, description, source, lesson_id, done,
           created_at, kind, hw_type)
          values (${item.id}, ${item.subject}, ${item.subjectName}, ${item.title}, ${item.dueDate},
                  ${item.description}, ${item.source}, ${item.lessonId}, 0, ${item.createdAt},
                  'unknown', ${item.type})`
        return item
      }).pipe(Effect.orDie),

    upsertSomtodayHomework: (items) =>
      Effect.gen(function* () {
        for (const item of items) {
          // keep local "done" flag when re-syncing
          yield* sql`insert into homework
            (id, subject, subject_name, title, due_date, description, source, lesson_id, done,
             created_at, hw_type)
            values (${item.id}, ${item.subject}, ${item.subjectName}, ${item.title}, ${item.dueDate},
                    ${item.description}, ${item.source}, ${item.lessonId}, ${item.done ? 1 : 0},
                    ${item.createdAt}, ${item.type})
            on conflict(id) do update set
              subject = excluded.subject,
              subject_name = excluded.subject_name,
              title = excluded.title,
              due_date = excluded.due_date,
              description = excluded.description,
              lesson_id = excluded.lesson_id,
              hw_type = excluded.hw_type`
        }
      }).pipe(Effect.orDie),

    getHomework: (id) =>
      sql<HomeworkRow>`select * from homework where id = ${id} and deleted = 0`.pipe(
        Effect.map((rows) => (rows[0] ? homeworkFromRow(rows[0]) : null)),
        Effect.orDie
      ),

    dedupCandidates: Effect.gen(function* () {
      const rows = yield* sql<{ readonly self_id: string; readonly somtoday_id: string }>`
        select s.id as self_id, t.id as somtoday_id
        from homework s
        join homework t
          on t.source = 'somtoday' and t.deleted = 0
         and abs(julianday(t.due_date) - julianday(s.due_date)) <= 3
        where s.source = 'self' and s.deleted = 0
          and s.due_date >= date('now', '-7 days')
          and not exists (
            select 1 from homework_dedup d where d.self_id = s.id and d.somtoday_id = t.id
          )`
      const pairs: Array<{ self: HomeworkItem; somtoday: HomeworkItem }> = []
      for (const row of rows) {
        const self = yield* store.getHomework(row.self_id)
        const somtoday = yield* store.getHomework(row.somtoday_id)
        if (self !== null && somtoday !== null) pairs.push({ self, somtoday })
      }
      return pairs
    }).pipe(Effect.orDie),

    recordDedupVerdict: (selfId, somtodayId, verdict) =>
      sql`insert into homework_dedup (self_id, somtoday_id, verdict, at)
        values (${selfId}, ${somtodayId}, ${verdict}, ${new Date().toISOString()})
        on conflict(self_id, somtoday_id) do update set verdict = excluded.verdict, at = excluded.at`
        .pipe(Effect.asVoid, Effect.orDie),

    mergeHomework: (selfId, somtodayId) =>
      Effect.gen(function* () {
        const self = yield* store.getHomework(selfId)
        const somtoday = yield* store.getHomework(somtodayId)
        if (self === null || somtoday === null) return false
        if (self.done && !somtoday.done) {
          yield* sql`update homework set done = 1 where id = ${somtodayId}`
        }
        yield* sql`update homework set deleted = 1 where id = ${selfId}`
        yield* sql`delete from plan_items where homework_id = ${selfId}`
        yield* store.recordDedupVerdict(selfId, somtodayId, "same")
        return true
      }).pipe(Effect.orDie),

    setHomeworkDone: (id, done) =>
      sql<{ readonly n: number }>`
        select count(*) as n from homework where id = ${id} and deleted = 0`.pipe(
        Effect.flatMap((rows) =>
          (rows[0]?.n ?? 0) === 0
            ? Effect.succeed(false)
            : sql`update homework set done = ${done ? 1 : 0} where id = ${id}`.pipe(
              Effect.andThen(
                done
                  ? sql`update plan_items set done = 1 where homework_id = ${id}`
                  : Effect.void
              ),
              Effect.map(() => true)
            )
        ),
        Effect.orDie
      ),

    deleteHomework: (id) =>
      sql<{ readonly n: number }>`
        select count(*) as n from homework where id = ${id} and deleted = 0`.pipe(
        Effect.flatMap((rows) =>
          (rows[0]?.n ?? 0) === 0
            ? Effect.succeed(false)
            : sql`update homework set deleted = 1 where id = ${id}`.pipe(
              Effect.andThen(sql`delete from plan_items where homework_id = ${id}`),
              Effect.map(() => true)
            )
        ),
        Effect.orDie
      ),

    openHomework: (fromDate, toDateExclusive) =>
      sql<HomeworkRow>`
        select * from homework
        where due_date >= ${fromDate} and due_date < ${toDateExclusive}
          and done = 0 and deleted = 0
        order by due_date asc, subject asc`.pipe(
        Effect.map((rows) => rows.map(homeworkFromRow)),
        Effect.orDie
      ),

    hasHomeworkForLesson: (lessonId) =>
      sql<{ readonly n: number }>`
        select count(*) as n from homework where lesson_id = ${lessonId} and deleted = 0`.pipe(
        Effect.map((rows) => (rows[0]?.n ?? 0) > 0),
        Effect.orDie
      ),

    pendingPrompts: sql<PromptRow>`
      select * from prompts where status = 'pending' order by created_at asc`.pipe(
      Effect.map((rows) => rows.map(promptFromRow)),
      Effect.orDie
    ),

    createPrompt: (options) =>
      Effect.gen(function* () {
        const prompt: Prompt = {
          id: crypto.randomUUID(),
          kind: options.kind,
          text: options.text,
          lessonId: options.lessonId ?? null,
          subject: options.subject ?? null,
          status: "pending",
          answer: null,
          createdAt: new Date().toISOString()
        }
        yield* sql`insert into prompts
          (id, kind, text, lesson_id, subject, status, answer, created_at)
          values (${prompt.id}, ${prompt.kind}, ${prompt.text}, ${prompt.lessonId},
                  ${prompt.subject}, 'pending', null, ${prompt.createdAt})`
        return prompt
      }).pipe(Effect.orDie),

    hasPromptForLesson: (lessonId) =>
      sql<{ readonly n: number }>`
        select count(*) as n from prompts where lesson_id = ${lessonId}`.pipe(
        Effect.map((rows) => (rows[0]?.n ?? 0) > 0),
        Effect.orDie
      ),

    answerPrompt: (answer) =>
      sql`update prompts
        set status = ${answer.dismissed ? "dismissed" : "answered"}, answer = ${answer.answer ?? null}
        where id = ${answer.id} and status = 'pending'`.pipe(
        Effect.map(() => true),
        Effect.orDie
      ),

    recordSignal: (signal) =>
      sql`insert into signals (kind, at) values (${signal.kind}, ${signal.at})`.pipe(
        Effect.orDie
      ),

    getMeta: (key) =>
      sql<{ readonly value: string }>`select value from meta where key = ${key}`.pipe(
        Effect.map((rows) => rows[0]?.value ?? null),
        Effect.orDie
      ),

    setMeta: (key, value) =>
      sql`insert into meta (key, value) values (${key}, ${value})
        on conflict(key) do update set value = excluded.value`.pipe(Effect.orDie),

    addChatMessage: (role, content, attachments) =>
      Effect.gen(function* () {
        const message: ChatMessage = {
          id: crypto.randomUUID(),
          role,
          content,
          createdAt: new Date().toISOString(),
          attachments: attachments ?? []
        }
        yield* sql`insert into chat_messages (id, role, content, created_at, compacted, attachments)
          values (${message.id}, ${message.role}, ${message.content}, ${message.createdAt}, 0,
                  ${message.attachments.length === 0 ? null : JSON.stringify(message.attachments)})`
        return message
      }).pipe(Effect.orDie),

    // ordered by rowid (insertion order): two messages of the same turn can
    // share a millisecond, and created_at ties would flip question and answer
    recentChatMessages: (limit) =>
      sql<ChatMessageRow>`
        select id, role, content, created_at, attachments from chat_messages
        order by rowid desc limit ${limit}`.pipe(
        Effect.map((rows) => rows.map(chatMessageFromRow).reverse()),
        Effect.orDie
      ),

    uncompactedChatMessages: sql<ChatMessageRow>`
      select id, role, content, created_at, attachments from chat_messages
      where compacted = 0 order by rowid asc`.pipe(
      Effect.map((rows) => rows.map(chatMessageFromRow)),
      Effect.orDie
    ),

    markChatCompacted: (beforeIso) =>
      sql`update chat_messages set compacted = 1 where created_at < ${beforeIso}`.pipe(
        Effect.asVoid,
        Effect.orDie
      ),

    planItemsBetween: (fromDate, toDateExclusive) =>
      sql<PlanItemRow>`
        select p.id, p.homework_id, h.subject, h.subject_name, h.description, h.due_date, p.day,
               p.duration_minutes, p.title, p.done, p.created_at
        from plan_items p join homework h on h.id = p.homework_id
        where p.day >= ${fromDate} and p.day < ${toDateExclusive} and h.deleted = 0
        order by p.day asc, p.created_at asc`.pipe(
        Effect.map((rows) => rows.map(planItemFromRow)),
        Effect.orDie
      ),

    planItemsForHomework: (homeworkId) =>
      sql<PlanItemRow>`
        select p.id, p.homework_id, h.subject, h.subject_name, h.description, h.due_date, p.day,
               p.duration_minutes, p.title, p.done, p.created_at
        from plan_items p join homework h on h.id = p.homework_id
        where p.homework_id = ${homeworkId}
        order by p.day asc, p.created_at asc`.pipe(
        Effect.map((rows) => rows.map(planItemFromRow)),
        Effect.orDie
      ),

    setPlan: (homeworkId, items) =>
      Effect.gen(function* () {
        yield* sql`delete from plan_items where homework_id = ${homeworkId}`
        const now = new Date().toISOString()
        let i = 0
        for (const item of items) {
          // keep insertion order stable within a day
          const createdAt = new Date(Date.parse(now) + i++).toISOString()
          yield* sql`insert into plan_items (id, homework_id, day, duration_minutes, title, done, created_at)
            values (${crypto.randomUUID()}, ${homeworkId}, ${item.day}, ${Math.round(item.durationMinutes)},
                    ${item.title}, 0, ${createdAt})`
        }
        yield* store.setPlanningStatus(homeworkId, "planned")
        return yield* store.planItemsForHomework(homeworkId)
      }).pipe(Effect.orDie),

    setPlanItemDone: (id, done) =>
      Effect.gen(function* () {
        const rows = yield* sql<{ readonly homework_id: string }>`
          select homework_id from plan_items where id = ${id}`
        const homeworkId = rows[0]?.homework_id
        if (homeworkId === undefined) return false
        yield* sql`update plan_items set done = ${done ? 1 : 0} where id = ${id}`
        // all sessions done → the homework itself is done (and vice versa when reopened)
        const open = yield* sql<{ readonly n: number }>`
          select count(*) as n from plan_items where homework_id = ${homeworkId} and done = 0`
        yield* sql`update homework set done = ${(open[0]?.n ?? 0) === 0 ? 1 : 0} where id = ${homeworkId}`
        return true
      }).pipe(Effect.orDie),

    movePlanItem: (id, day) =>
      sql`update plan_items set day = ${day} where id = ${id}`.pipe(
        Effect.map(() => true),
        Effect.orDie
      ),

    setHomeworkKind: (id, kind) =>
      sql`update homework set kind = ${kind} where id = ${id}`.pipe(Effect.asVoid, Effect.orDie),

    updateHomework: (id, fields) =>
      Effect.gen(function* () {
        const current = yield* store.getHomework(id)
        if (current === null) return null
        const subject = fields.subject ?? current.subject
        const dueDate = fields.dueDate ?? current.dueDate
        const description = fields.description ?? current.description
        yield* sql`update homework
          set subject = ${subject}, due_date = ${dueDate}, description = ${description}
          where id = ${id}`
        return yield* store.getHomework(id)
      }).pipe(Effect.orDie),

    clearPlanning: (homeworkId) =>
      Effect.gen(function* () {
        yield* sql`delete from plan_items where homework_id = ${homeworkId}`
        yield* sql`delete from homework_planning where homework_id = ${homeworkId}`
      }).pipe(Effect.orDie),

    unclassifiedHomework: sql<HomeworkRow>`
      select * from homework
      where deleted = 0 and done = 0 and (kind is null or kind = 'unknown')
      order by due_date asc`.pipe(
      Effect.map((rows) => rows.map(homeworkFromRow)),
      Effect.orDie
    ),

    setPlanningStatus: (homeworkId, status) =>
      sql`insert into homework_planning (homework_id, status, at)
        values (${homeworkId}, ${status}, ${new Date().toISOString()})
        on conflict(homework_id) do update set status = excluded.status, at = excluded.at`
        .pipe(Effect.asVoid, Effect.orDie),

    unplannedHomework: (fromDate) =>
      sql<HomeworkRow>`
        select h.* from homework h
        where h.deleted = 0 and h.done = 0 and h.due_date >= ${fromDate} and h.kind = 'task' 
          and not exists (select 1 from homework_planning s where s.homework_id = h.id)
        order by h.due_date asc`.pipe(
        Effect.map((rows) => rows.map(homeworkFromRow)),
        Effect.orDie
      ),

    dayLoads: (fromDate, toDateExclusive) =>
      Effect.gen(function* () {
        const lessons = yield* sql<{ readonly day: string; readonly n: number }>`
          select date(start, 'localtime') as day, count(*) as n from lessons
          where start >= ${dayStartInstant(fromDate)} and start < ${dayStartInstant(toDateExclusive)}
            and cancelled = 0
          group by day`
        const planned = yield* sql<{ readonly day: string; readonly minutes: number }>`
          select day, sum(duration_minutes) as minutes from plan_items
          where day >= ${fromDate} and day < ${toDateExclusive} and done = 0
          group by day`
        const lessonMap = new Map(lessons.map((r) => [r.day, r.n]))
        const plannedMap = new Map(planned.map((r) => [r.day, r.minutes]))
        const days: Array<{ day: string; lessons: number; plannedMinutes: number }> = []
        for (let day = fromDate; day < toDateExclusive; day = addDays(day, 1)) {
          days.push({ day, lessons: lessonMap.get(day) ?? 0, plannedMinutes: plannedMap.get(day) ?? 0 })
        }
        return days
      }).pipe(Effect.orDie),

    getSettings: sql<{ readonly value: string }>`
      select value from meta where key = 'settings'`.pipe(
      Effect.map((rows) => {
        const raw = rows[0]?.value
        if (raw === undefined) return defaultSettings
        try {
          // merge over defaults (dropping keys from older versions) so stored
          // settings survive both added and removed fields
          const parsed = JSON.parse(raw) as Record<string, unknown>
          const merged: Record<string, unknown> = { ...defaultSettings }
          for (const key of Object.keys(defaultSettings)) {
            if (parsed[key] !== undefined) merged[key] = parsed[key]
          }
          return Option.getOrElse(
            Schema.decodeUnknownOption(SettingsSchema)(merged),
            () => defaultSettings
          )
        } catch {
          return defaultSettings
        }
      }),
      Effect.orDie
    ),

    setSettings: (settings) =>
      sql`insert into meta (key, value) values ('settings', ${JSON.stringify(settings)})
        on conflict(key) do update set value = excluded.value`.pipe(
        Effect.map(() => settings),
        Effect.orDie
      )
  }

  return store
})

export const StoreLive = Layer.effect(Store)(makeStore)
