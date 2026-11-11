import { loadEnvConfig } from "@next/env";
import { getDatabase, closeDatabases } from "../lib/server/database";
import { databasePath } from "../lib/server/storage-path";

loadEnvConfig(process.cwd());
try {
  const db = getDatabase();
  const integrity = db.prepare("PRAGMA integrity_check").get();
  if (integrity?.integrity_check !== "ok") throw new Error("SQLite 完整性检查失败");
  const counts = Object.fromEntries(
    ["projects", "publications", "production_states", "uploaded_assets"].map((table) => [
      table,
      db.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count,
    ]),
  );
  console.log(JSON.stringify({ database: databasePath(), integrity: "ok", counts }, null, 2));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  closeDatabases();
}
