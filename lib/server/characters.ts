import { randomUUID } from "node:crypto";
import { getDatabase, transaction } from "./database";
import { saveCharacterSchema, type SavedCharacter } from "@/lib/characters";
function database() {
  const db = getDatabase();
  db.exec(
    "CREATE TABLE IF NOT EXISTS character_library (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)))",
  );
  return db;
}
export function listCharacters(): SavedCharacter[] {
  return database()
    .prepare("SELECT document FROM character_library ORDER BY updated_at DESC,id")
    .all()
    .map((row) => JSON.parse(String(row.document)));
}
export function saveCharacter(raw: unknown): SavedCharacter {
  const input = saveCharacterSchema.parse(raw),
    db = database();
  return transaction(db, () => {
    const row = input.id
      ? db.prepare("SELECT document FROM character_library WHERE id=?").get(input.id)
      : undefined;
    const current: SavedCharacter | undefined = row ? JSON.parse(String(row.document)) : undefined;
    if (input.id && !current) throw new Error("角色不存在，请另存为新角色");
    if (current && input.revision !== current.revision)
      throw new Error("角色已更新，请重新打开角色库");
    const now = new Date().toISOString();
    const character: SavedCharacter = {
      ...input,
      id: current?.id ?? randomUUID(),
      revision: (current?.revision ?? 0) + 1,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    db.prepare(
      "INSERT INTO character_library VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,document=excluded.document",
    ).run(character.id, now, JSON.stringify(character));
    return character;
  });
}
