#!/usr/bin/env bash
# Update the locally installed dsh-mobile-harness plugin from this repo checkout.
#
#   scripts/update-plugin.sh                 # sync + relink + syntax check
#   scripts/update-plugin.sh --check         # only report repo vs installed version/diff
#   scripts/update-plugin.sh --profile web   # another DSH profile
#   scripts/update-plugin.sh --dsh-home DIR  # another DSH_HOME
#
# It copies plugins/dsh-mobile-harness into $DSH_HOME/plugins/dsh-mobile-harness, forces
# pnpm to relink the profile's `file:` dependency (pnpm skips unchanged dir specs on its
# own), checks syntax, then reminds you to restart DSH. It never restarts DSH for you.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$repo_root/plugins/dsh-mobile-harness"
dsh_home="${DSH_HOME:-$HOME/.dsh}"
profile="desktop"
check_only=0

usage() { sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while (($#)); do
  case "$1" in
    --profile) profile="${2:?--profile needs a name}"; shift 2 ;;
    --dsh-home) dsh_home="${2:?--dsh-home needs a path}"; shift 2 ;;
    --check) check_only=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -d "$src" ]] || { echo "missing plugin source: $src" >&2; exit 1; }

dst="$dsh_home/plugins/dsh-mobile-harness"
profile_dir="$dsh_home/profiles/$profile"
version() { node -e "process.stdout.write(require('$1/package.json').version)" 2>/dev/null || true; }
repo_version="$(version "$src")"

dirty="$(git -C "$repo_root" status --porcelain -- plugins/dsh-mobile-harness 2>/dev/null | wc -l | tr -d ' ')"
head_commit="$(git -C "$repo_root" rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "repo:    $src ($repo_version, ${head_commit}${dirty:+ +$dirty uncommitted file(s)})"
echo "install: $dst"
if [[ "${dirty:-0}" -gt 0 && $check_only -eq 0 ]]; then
  echo "note:    syncing the working tree, not the committed state (commit first if you want a clean install)"
fi

if ((check_only)); then
  installed="$(version "$dst")"
  echo "installed: ${installed:-（未安装）}"
  if [[ -d "$dst" && -d "$profile_dir/node_modules/dsh-mobile-harness" ]]; then
    installed_nm="$(version "$profile_dir/node_modules/dsh-mobile-harness")"
    echo "profile:  $profile_dir/node_modules/dsh-mobile-harness ($installed_nm)"
    echo "relinked: $( [[ "$installed_nm" == "$repo_version" ]] && echo yes || echo 'no（运行 update 即可）')"
  fi
  diff -rq "$src" "$dst" >/dev/null 2>&1 && echo "files:    identical" || echo "files:    differ（运行 update 即可）"
  exit 0
fi

[[ -d "$profile_dir" ]] || {
  echo "no such DSH profile: $profile_dir" >&2
  echo "available: $(ls "$dsh_home/profiles" 2>/dev/null | tr '\n' ' ')" >&2
  exit 1
}
command -v pnpm >/dev/null || { echo "pnpm not found in PATH (start the shell that has it, e.g. fnm)" >&2; exit 1; }
case "$dsh_home" in
  */.dsh) ;;
  *) echo "refusing DSH_HOME outside ~/.dsh: $dsh_home" >&2; exit 1 ;;
esac

echo "profile: $profile_dir"
mkdir -p "$dsh_home/plugins"
rsync -a --delete "$src/" "$dst/"
echo "1/4 synced $repo_version into $dst"

# pnpm treats an unchanged `file:` directory spec as "already installed" and keeps the old
# copy inside node_modules; drop it so the next install re-links the new files.
rm -rf "$profile_dir/node_modules/dsh-mobile-harness"
( cd "$profile_dir" && pnpm install --prefer-offline >/dev/null )
echo "2/4 relinked the profile dependency"

installed_nm="$(version "$profile_dir/node_modules/dsh-mobile-harness")"
[[ "$installed_nm" == "$repo_version" ]] || {
  echo "unexpected: node_modules has ${installed_nm:-nothing}, expected $repo_version" >&2
  exit 1
}
diff -rq "$src" "$dst" >/dev/null || { echo "sync mismatch between repo and install dir" >&2; exit 1; }
echo "3/4 verified installed copy ($installed_nm, identical files)"

for file in "$dst"/lib/*.js; do node --check "$file" >/dev/null; done
echo "4/4 syntax check passed"

cat <<EOF

Updated to $repo_version.
Restart DeepSeek Harness (quit from the tray/menu bar, then reopen) to load it.
EOF
