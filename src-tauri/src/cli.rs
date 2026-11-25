//! Install the `wart` command-line launcher from inside the app, pointing at
//! wherever this copy of CodeWart lives. Works for any install location, so a
//! downloaded build gets `wart .` without the source repo.

use crate::actions::find_in_path;
use serde::Serialize;
use std::path::{Path, PathBuf};

const NAMES: &[&str] = &["wart", "codewart"];
const MARKER: &str = "CodeWart launcher";

#[cfg(unix)]
const TEMPLATE: &str = include_str!("../../scripts/wart");
const SKILL: &str = include_str!("../../skills/codewart-review/SKILL.md");
const SKILL_NAME: &str = "name: codewart-review";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    /// `wart` on PATH is one of our launchers.
    pub installed: bool,
    /// Where it is (or would be) installed.
    pub path: String,
    /// The install directory is on PATH.
    pub on_path: bool,
}

fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default()
}

fn ours(p: &Path) -> bool {
    std::fs::read_to_string(p)
        // Case-insensitive: launchers installed before the rename say "Codewart launcher".
        .map(|s| s.to_lowercase().contains(&MARKER.to_lowercase()))
        .unwrap_or(false)
}

fn writable(dir: &Path) -> bool {
    let probe = dir.join(".codewart-write-test");
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

/// Preferred install directory: a user bin dir already on PATH, else a
/// writable system one, else ~/.local/bin (and tell the user to add it).
#[allow(unused_variables)]
fn install_dir() -> PathBuf {
    let on_path = path_dirs();
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let apps = PathBuf::from(local).join("Microsoft").join("WindowsApps");
            if apps.is_dir() {
                return apps;
            }
        }
        let home = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_default();
        return home.join("bin");
    }
    #[cfg(unix)]
    {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default();
        let candidates = [
            home.join(".local/bin"),
            home.join("bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/homebrew/bin"),
        ];
        for c in &candidates {
            if on_path.contains(c) && c.is_dir() && writable(c) {
                return c.clone();
            }
        }
        home.join(".local/bin")
    }
}

fn file_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.cmd")
    } else {
        name.to_string()
    }
}

pub fn status() -> CliStatus {
    let dir = install_dir();
    let found = find_in_path(&file_name("wart")).or_else(|| find_in_path("wart"));
    let installed = found.as_deref().is_some_and(ours);
    CliStatus {
        installed,
        path: found
            .filter(|_| installed)
            .unwrap_or_else(|| dir.join(file_name("wart")))
            .to_string_lossy()
            .into_owned(),
        on_path: path_dirs().contains(&dir),
    }
}

fn script(exe: &Path) -> String {
    #[cfg(unix)]
    {
        let line = format!("CODEWART_BIN=\"${{CODEWART_BIN:-{}}}\"", exe.display());
        TEMPLATE.replace("# @CODEWART_BIN@", &line)
    }
    #[cfg(windows)]
    {
        format!(
            "@echo off\r\nrem {MARKER} (wart .)\r\nset \"CODEWART_CWD=%CD%\"\r\nif \"%~1\"==\"\" (start \"\" \"{exe}\" \"%CD%\") else (start \"\" \"{exe}\" %*)\r\n",
            exe = exe.display()
        )
    }
}

pub fn install() -> Result<CliStatus, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.canonicalize().unwrap_or(exe);
    let dir = install_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let body = script(&exe);
    for name in NAMES {
        let target = dir.join(file_name(name));
        if target.exists() && !ours(&target) {
            if *name == "wart" {
                return Err(format!(
                    "{} already exists and is not a CodeWart launcher",
                    target.display()
                ));
            }
            continue; // leave someone else's `codewart` alone
        }
        std::fs::write(&target, &body)
            .map_err(|e| format!("cannot write {}: {e}", target.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }
    }
    let mut st = status();
    st.installed = true;
    st.path = dir.join(file_name("wart")).to_string_lossy().into_owned();
    Ok(st)
}

/// A copy that should not pin launchers to itself: dev builds, or an app run
/// straight from a mounted disk image / macOS App Translocation.
fn transient(exe: &Path) -> bool {
    let s = exe.to_string_lossy();
    cfg!(debug_assertions) || s.starts_with("/Volumes/") || s.contains("AppTranslocation")
}

/// Rewrite `files` that `keep` accepts and whose content differs from `body`.
fn rewrite(files: &[PathBuf], body: &str, keep: impl Fn(&Path) -> bool) -> Vec<String> {
    let mut done = Vec::new();
    for f in files {
        if !f.is_file() || !keep(f) || std::fs::read_to_string(f).is_ok_and(|s| s == body) {
            continue;
        }
        if std::fs::write(f, body).is_ok() {
            done.push(f.to_string_lossy().into_owned());
        }
    }
    done
}

/// After an update: launchers and the Claude Code skill installed by an
/// earlier version are rewritten to match this one (never installed = left
/// alone). Returns the files that changed.
pub fn refresh() -> Vec<String> {
    let Ok(exe) = std::env::current_exe() else {
        return Vec::new();
    };
    let exe = exe.canonicalize().unwrap_or(exe);
    if transient(&exe) {
        return Vec::new();
    }
    let mut dirs = vec![install_dir()];
    if let Some(found) = find_in_path(&file_name("wart")) {
        if let Some(d) = found.parent() {
            dirs.push(d.to_path_buf());
        }
    }
    dirs.dedup();
    let launchers: Vec<PathBuf> = dirs
        .iter()
        .flat_map(|d| NAMES.iter().map(move |n| d.join(file_name(n))))
        .collect();
    let mut done = rewrite(&launchers, &script(&exe), ours);
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let skill = PathBuf::from(home).join(".claude/skills/codewart-review/SKILL.md");
        done.extend(rewrite(&[skill], SKILL, |p| {
            std::fs::read_to_string(p).is_ok_and(|s| s.contains(SKILL_NAME))
        }));
    }
    done
}

#[cfg(all(test, unix))]
pub fn script_for_test(exe: &Path) -> String {
    script(exe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_only_installed_outdated_files() {
        let d = std::env::temp_dir().join(format!("cw-cli-refresh-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let old = d.join("old");
        let same = d.join("same");
        let foreign = d.join("foreign");
        let missing = d.join("missing");
        std::fs::write(&old, "# CodeWart launcher v1").unwrap();
        std::fs::write(&same, "# CodeWart launcher v2").unwrap();
        std::fs::write(&foreign, "someone else's wart").unwrap();
        let files = [old.clone(), same.clone(), foreign.clone(), missing.clone()];
        let done = rewrite(&files, "# CodeWart launcher v2", ours);
        assert_eq!(done, vec![old.to_string_lossy().into_owned()]);
        assert_eq!(
            std::fs::read_to_string(&old).unwrap(),
            "# CodeWart launcher v2"
        );
        assert_eq!(
            std::fs::read_to_string(&foreign).unwrap(),
            "someone else's wart"
        );
        assert!(!missing.exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn dev_builds_never_pin_launchers() {
        assert!(transient(Path::new(
            "/Volumes/CodeWart/CodeWart.app/Contents/MacOS/codewart"
        )));
        assert_eq!(
            transient(Path::new(
                "/Applications/CodeWart.app/Contents/MacOS/codewart"
            )),
            cfg!(debug_assertions)
        );
    }
}
