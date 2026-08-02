import dotenv from "dotenv";
dotenv.config();

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

export const NODE_ENV = process.env.NODE_ENV ?? "development";
export const IS_PROD = NODE_ENV === "production";
export const PORT = Number(process.env.PORT ?? 4000);
export const DATABASE_URL =
  NODE_ENV === "test" ? required("TEST_DATABASE_URL") : required("DATABASE_URL");
export const SESSION_SECRET = required("SESSION_SECRET");
export const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);
export const ANILIST_URL = process.env.ANILIST_URL ?? "https://graphql.anilist.co";

export const SESSION_COOKIE_NAME = "sid";
