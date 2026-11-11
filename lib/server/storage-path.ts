import * as path from "node:path";

export const dataRoot = () =>
  path.resolve(process.env.STORYREEL_DATA_DIR ?? path.join(process.cwd(), ".storyreel"));
export const databasePath = () => path.join(dataRoot(), "storyreel.sqlite");
export function assertStorageId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("无效数据 ID");
}
