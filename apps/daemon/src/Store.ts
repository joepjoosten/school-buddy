import type {
  HomeworkInput,
  HomeworkItem,
  HomeworkSource,
  Lesson,
  Prompt,
  PromptAnswer,
  PromptKind,
  Settings,
  Signal,
  WeekData
} from "@school-buddy/shared"
import { defaultSettings, Settings as SettingsSchema } from "@school-buddy/shared"
import * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { weekBoundsOf } from "./time.ts"

export interface StoreShape {
  readonly replaceLessons: (
    lessons: ReadonlyArray<Lesson>,
    fromDate: string,
    toDateExclusive: string
  ) => Effect.Effect<void>
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
  readonly setHomeworkDone: (id: string, done: boolean) => Effect.Effect<boolean>
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
    cancelled integer not null default 0
  )`,
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
  `create table if not exists meta (
    key text primary key,
    value text not null
  )`
]

interface LessonRow {
  readonly id: string
  readonly subject: string
  readonly title: string
  readonly location: string | null
  readonly teacher: string | null
  readonly start: string
  readonly end: string
  readonly cancelled: number
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

const lessonFromRow = (row: LessonRow): Lesson => ({
  id: row.id,
  subject: row.subject,
  title: row.title,
  location: row.location,
  teacher: row.teacher,
  start: row.start,
  end: row.end,
  cancelled: row.cancelled === 1
})

const homeworkFromRow = (row: HomeworkRow): HomeworkItem => ({
  id: row.id,
  subject: row.subject,
  dueDate: row.due_date,
  description: row.description,
  source: row.source as HomeworkItem["source"],
  lessonId: row.lesson_id,
  done: row.done === 1,
  createdAt: row.created_at
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
    yield* sql.unsafe(migration).pipe(Effect.orDie)
  }

  const store: StoreShape = {
    replaceLessons: (lessons, fromDate, toDateExclusive) =>
      Effect.gen(function* () {
        yield* sql`delete from lessons where start >= ${fromDate} and start < ${toDateExclusive}`
        for (const l of lessons) {
          yield* sql`insert or replace into lessons
            (id, subject, title, location, teacher, start, end, cancelled)
            values (${l.id}, ${l.subject}, ${l.title}, ${l.location}, ${l.teacher},
                    ${l.start}, ${l.end}, ${l.cancelled ? 1 : 0})`
        }
      }).pipe(Effect.orDie),

    weekData: (date) =>
      Effect.gen(function* () {
        const bounds = weekBoundsOf(date)
        const lessonRows = yield* sql<LessonRow>`
          select * from lessons
          where start >= ${bounds.monday} and start < ${bounds.nextMonday}
          order by start asc`
        const homeworkRows = yield* sql<HomeworkRow>`
          select * from homework
          where due_date >= ${bounds.monday} and due_date < ${bounds.nextMonday}
          order by due_date asc, subject asc`
        return {
          year: bounds.year,
          week: bounds.week,
          monday: bounds.monday,
          lessons: lessonRows.map(lessonFromRow),
          homework: homeworkRows.map(homeworkFromRow)
        } satisfies WeekData
      }).pipe(Effect.orDie),

    lessonsEndedBetween: (fromIso, toIso) =>
      sql<LessonRow>`
        select * from lessons
        where end > ${fromIso} and end <= ${toIso} and cancelled = 0
        order by end asc`.pipe(
        Effect.map((rows) => rows.map(lessonFromRow)),
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
          dueDate: input.dueDate,
          description: input.description,
          source,
          lessonId: input.lessonId,
          done: false,
          createdAt: new Date().toISOString()
        }
        yield* sql`insert into homework
          (id, subject, due_date, description, source, lesson_id, done, created_at)
          values (${item.id}, ${item.subject}, ${item.dueDate}, ${item.description},
                  ${item.source}, ${item.lessonId}, 0, ${item.createdAt})`
        return item
      }).pipe(Effect.orDie),

    upsertSomtodayHomework: (items) =>
      Effect.gen(function* () {
        for (const item of items) {
          // keep local "done" flag when re-syncing
          yield* sql`insert into homework
            (id, subject, due_date, description, source, lesson_id, done, created_at)
            values (${item.id}, ${item.subject}, ${item.dueDate}, ${item.description},
                    ${item.source}, ${item.lessonId}, ${item.done ? 1 : 0}, ${item.createdAt})
            on conflict(id) do update set
              subject = excluded.subject,
              due_date = excluded.due_date,
              description = excluded.description,
              lesson_id = excluded.lesson_id`
        }
      }).pipe(Effect.orDie),

    setHomeworkDone: (id, done) =>
      sql`update homework set done = ${done ? 1 : 0} where id = ${id}`.pipe(
        Effect.map(() => true),
        Effect.orDie
      ),

    hasHomeworkForLesson: (lessonId) =>
      sql<{ readonly n: number }>`
        select count(*) as n from homework where lesson_id = ${lessonId}`.pipe(
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
        set status = ${answer.dismissed ? "dismissed" : "answered"}, answer = ${answer.answer}
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

    getSettings: sql<{ readonly value: string }>`
      select value from meta where key = 'settings'`.pipe(
      Effect.map((rows) => {
        const raw = rows[0]?.value
        if (raw === undefined) return defaultSettings
        try {
          return Option.getOrElse(
            Schema.decodeUnknownOption(SettingsSchema)(JSON.parse(raw)),
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
