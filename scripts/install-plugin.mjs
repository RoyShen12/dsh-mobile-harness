#!/usr/bin/env node
// DSH Mobile Harness installer: point a DSH profile at this repo's plugin folder.
// It edits <DSH_HOME>/profiles/<profile>/package.json (dependency + bundle entry),
// then asks you to run the profile install and restart DSH.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..")

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const dryRun = process.argv.includes("--dry-run")
const dshHome = resolve(arg("dsh-home", process.env.DSH_HOME || join(homedir(), ".dsh")))
const profile = arg("profile", "desktop")
const profilesDir = join(dshHome, "profiles")
const profileDir = join(profilesDir, profile)

if (!existsSync(profileDir)) {
  const names = existsSync(profilesDir) ? readdirSync(profilesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []
  console.error("找不到 profile: " + profileDir)
  console.error("现有的 profile: " + (names.length ? names.join(", ") : "(无)"))
  console.error("用 --profile <名字> 指定，或 --dsh-home <路径> 指定 DSH_HOME。")
  process.exit(1)
}

const pluginDir = join(repoRoot, "plugins", "dsh-mobile-harness")
const pluginPkg = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8"))
const pluginName = pluginPkg.name
const spec = "file:" + pluginDir.replace(/\\/g, "/")

const pkgPath = join(profileDir, "package.json")
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
pkg.dependencies = pkg.dependencies || {}
const previous = pkg.dependencies[pluginName]
pkg.dependencies[pluginName] = spec

pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
const addedBundle = !bundles.includes(pluginName)
if (addedBundle) bundles.push(pluginName)
pkg.dsh.profile.bundles = bundles

const next = JSON.stringify(pkg, null, 2) + "\n"
console.log("profile:  " + profileDir)
console.log("plugin:   " + pluginDir + "  (" + pluginName + "@" + pluginPkg.version + ")")
console.log("dependency: " + (previous ? previous + "  ->  " : "") + spec)
console.log("bundle entry: " + (addedBundle ? "已添加" : "已存在"))

if (dryRun) {
  console.log("\n--dry-run：不写文件。")
  process.exit(0)
}
writeFileSync(pkgPath, next)
console.log("\n已写入 " + pkgPath)
console.log("接下来：")
console.log("  1. cd \"" + profileDir + "\" && pnpm install")
console.log("  2. 重启 DeepSeek Harness（退出托盘图标后重新打开）")
console.log("  3. 打开 DSH → 会话侧栏「远程」→ 远程访问开关")