import { execSync } from "child_process";

export default function getGitStatus() {
  const status = execSync("git status --porcelain").toString().trim();
  const branch = execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
  const commit = execSync("git rev-parse HEAD").toString().trim();
  const shortCommit = execSync("git rev-parse --short HEAD").toString().trim();
  return { status, branch, commit, shortCommit };
}
