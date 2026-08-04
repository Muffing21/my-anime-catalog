import { query } from "../../config/db.config";
export const resetDb = async (): Promise<void> => {
  await query("TRUNCATE list_entries, sessions, anime, users RESTART IDENTITY CASCADE");
};
