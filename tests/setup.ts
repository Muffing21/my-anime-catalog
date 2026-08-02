import { execSync } from "child_process";
export default function () {
  execSync("ts-node db/migrate.ts", {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "test" },
  });
}
