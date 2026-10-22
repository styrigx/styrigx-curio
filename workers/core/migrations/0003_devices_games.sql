-- 奇趣三栏（发现 / 设备 / 游戏）：设备和游戏两张表。照片在 R2（FILES：photos/<device|game>/<id>-<时间>.<扩展名>），这里只记 key。
-- 代码里也有 CREATE TABLE IF NOT EXISTS 兜底（src/api/_items.js 的 ITEM_SCHEMA，两边要一致，测试核对）。
-- 日期都是 'YYYY-MM-DD' 文本，空串表示没填。使用天数不存，前端按 购买日期 → 退役日期（没退役就是今天）现算。
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  bought_at TEXT NOT NULL DEFAULT '',
  retired_at TEXT NOT NULL DEFAULT '',
  replaced_by INTEGER NOT NULL DEFAULT 0,
  os TEXT NOT NULL DEFAULT '',
  specs TEXT NOT NULL DEFAULT '',
  accessories TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 0,
  pos INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  device_id INTEGER NOT NULL DEFAULT 0,
  edition TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'want',
  rating INTEGER NOT NULL DEFAULT 0,
  review TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 0,
  pos INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS games_status ON games (status, pos);
