import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 분석 원문이나 URL은 저장하지 않습니다. 공개 서비스 남용 방지를 위해
// 비밀키 기반 HMAC으로 매일 달라지는 가명키와 짧은 요청 창만 보관합니다.
export const rateWindows = sqliteTable(
  "rate_windows",
  {
    clientKey: text("client_key").primaryKey(),
    requestCount: integer("request_count").notNull(),
    resetAt: integer("reset_at").notNull(),
  },
  (table) => [index("rate_windows_reset_at_idx").on(table.resetAt)],
);
