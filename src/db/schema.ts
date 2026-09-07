import { pgTable, text, uuid, integer, boolean, jsonb, timestamp, serial, index } from "drizzle-orm/pg-core";

export const games = pgTable(
  "games",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    status: text("status").notNull().default("waiting"), // waiting | playing | finished
    state: jsonb("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("games_code_idx").on(t.code)]
);

export const scores = pgTable(
  "scores",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    score: integer("score").notNull(),
    mode: text("mode").notNull().default("classic"),
    board: text("board").notNull().default("square"),
    won: boolean("won").notNull().default(false),
    turns: integer("turns").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scores_score_idx").on(t.score)]
);
