import { Pool, QueryResultRow } from "pg";
import { DATABASE_URL } from "./constants.config";

export const pool = new Pool({ connectionString: DATABASE_URL });

// Thin typed helper so services never import Pool directly.
export const query = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> => {
  const result = await pool.query<T>(text, params as never[]);
  return result.rows;
};

export const connectDb = async (): Promise<void> => {
  await pool.query("SELECT 1");
  console.log("Postgres connection established.");
};
