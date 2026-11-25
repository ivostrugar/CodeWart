//! `wart review`: an agent asks for a review and waits for it.
//!
//! The launcher writes `<tmp>/codewart-reviews/review-<id>.md.waiting` (its pid)
//! and starts / forwards to the app with `--review-reply=<that .md path>`. The
//! app shows the request; sending the review writes the `.md` file, which the
//! waiting launcher prints and deletes.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const DIR_NAME: &str = "codewart-reviews";
/// After `--timeout` the launcher exits and is run again; treat the request as
/// alive for this long even though its pid is gone.
const RERUN_GRACE: Duration = Duration::from_secs(15 * 60);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRequest {
    /// Worktree to review (as given by the launcher).
    pub path: String,
    /// File the review is written to.
    pub reply: String,
    /// Optional note from the agent ("what I changed, what to look at").
    pub message: Option<String>,
}

/// Parse `--review-reply=… [--review-message=…] PATH` from launcher arguments.
pub fn from_args(args: &[String], paths: &[String]) -> Option<ReviewRequest> {
    let val = |key: &str| {
        args.iter()
            .find_map(|a| a.strip_prefix(key))
            .map(str::to_string)
    };
    let reply = val("--review-reply=")?;
    let path = paths.first()?.clone();
    let message = val("--review-message=").filter(|m| !m.trim().is_empty());
    Some(ReviewRequest {
        path,
        reply,
        message,
    })
}

/// `wart answer ID`: the agent's answers to the comments of review `ID`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewAnswer {
    /// Review id from the review's last line.
    pub review: String,
    /// The answers as the agent wrote them (`1. solved: …` lines).
    pub text: String,
}

/// The `--review-answer=FILE` argument, if any.
pub fn answer_arg(args: &[String]) -> Option<&str> {
    args.iter().find_map(|a| a.strip_prefix("--review-answer="))
}

/// Read and delete an answers file the launcher wrote:
/// `…/codewart-reviews/answer-<review id>-<n>.md`. Deleting it tells the
/// launcher the answers arrived.
pub fn take_answer(file: &str) -> Result<ReviewAnswer, String> {
    let p = PathBuf::from(file);
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let dir = p
        .parent()
        .and_then(|d| d.file_name())
        .and_then(|n| n.to_str());
    let review = name
        .strip_prefix("answer-")
        .and_then(|r| r.strip_suffix(".md"))
        .and_then(|r| r.rsplit_once('-'))
        .map(|(id, _)| id)
        .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()));
    let (true, Some(DIR_NAME), Some(review)) = (p.is_absolute(), dir, review) else {
        return Err(format!("not a review answers file: {file}"));
    };
    let text = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&p);
    Ok(ReviewAnswer {
        review: review.to_string(),
        text,
    })
}

/// Only files the launcher creates may be written: `…/codewart-reviews/review-*.md`.
fn checked(reply: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(reply);
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let dir = p
        .parent()
        .and_then(|d| d.file_name())
        .and_then(|n| n.to_str());
    let ok = p.is_absolute()
        && dir == Some(DIR_NAME)
        && name.starts_with("review-")
        && name.ends_with(".md")
        && !name.contains("..");
    if ok {
        Ok(p)
    } else {
        Err(format!("not a review reply file: {reply}"))
    }
}

fn with_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

/// Hand the review to the waiting launcher. A second review before the first
/// was picked up is appended, so nothing is lost.
pub fn write_reply(reply: &str, text: &str) -> Result<(), String> {
    let p = checked(reply)?;
    let mut body = std::fs::read_to_string(&p)
        .unwrap_or_default()
        .trim_end()
        .to_string();
    if !body.is_empty() {
        body.push_str("\n\n---\n\n");
    }
    body.push_str(text.trim_end());
    body.push('\n');
    // Write then rename, so the launcher never prints a half-written file.
    let tmp = with_suffix(&p, ".tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// Is a launcher still waiting for this reply?
pub fn is_waiting(reply: &str) -> bool {
    let Ok(p) = checked(reply) else { return false };
    let marker = with_suffix(&p, ".waiting");
    let Ok(meta) = std::fs::metadata(&marker) else {
        return false;
    };
    let recent = meta
        .modified()
        .ok()
        .and_then(|m| SystemTime::now().duration_since(m).ok())
        .is_some_and(|age| age < RERUN_GRACE);
    recent || pid_alive(&marker)
}

fn pid_alive(marker: &Path) -> bool {
    let Some(pid) = std::fs::read_to_string(marker)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
    else {
        return false;
    };
    #[cfg(unix)]
    {
        crate::git::command("kill")
            .args(["-0", &pid.to_string()])
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        let d = std::env::temp_dir()
            .join(format!("cw-review-test-{}", std::process::id()))
            .join(DIR_NAME);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn parses_launcher_args() {
        let args: Vec<String> = [
            "wart",
            "--review-reply=/t/codewart-reviews/review-1.md",
            "--review-message=",
            "/repo",
        ]
        .map(String::from)
        .to_vec();
        let r = from_args(&args, &["/repo".into()]).unwrap();
        assert_eq!(r.reply, "/t/codewart-reviews/review-1.md");
        assert_eq!(r.path, "/repo");
        assert_eq!(r.message, None);
        assert!(from_args(&["wart".into(), "/repo".into()], &["/repo".into()]).is_none());
    }

    #[test]
    fn only_writes_launcher_reply_files() {
        let tmp = std::env::temp_dir();
        let p = |rel: &str| tmp.join(rel).to_string_lossy().into_owned();
        assert!(checked(&p("passwd")).is_err());
        assert!(checked(&p("codewart-reviews/notes.md")).is_err());
        assert!(checked(&p("other/review-1.md")).is_err());
        assert!(checked("codewart-reviews/review-1.md").is_err(), "relative");
        assert!(checked(&p("codewart-reviews/review-1.md")).is_ok());
    }

    #[test]
    fn takes_answer_files_only() {
        let d = dir();
        let f = d.join("answer-r7k2m9-123.md");
        std::fs::write(&f, "1. solved: done\n").unwrap();
        let a = take_answer(f.to_str().unwrap()).unwrap();
        assert_eq!(a.review, "r7k2m9");
        assert_eq!(a.text, "1. solved: done\n");
        assert!(!f.exists(), "consumed");
        for bad in ["answer--1.md", "answer-a.b-1.md", "notes.md", "review-1.md"] {
            let f = d.join(bad);
            std::fs::write(&f, "x").unwrap();
            assert!(take_answer(f.to_str().unwrap()).is_err(), "{bad}");
            let _ = std::fs::remove_file(&f);
        }
        assert!(
            take_answer("codewart-reviews/answer-a-1.md").is_err(),
            "relative"
        );
        let args: Vec<String> = ["wart", "--review-answer=/t/x.md"]
            .map(String::from)
            .to_vec();
        assert_eq!(answer_arg(&args), Some("/t/x.md"));
    }

    #[test]
    fn writes_appends_and_tracks_waiting() {
        let d = dir();
        let reply = d.join("review-42.md");
        let r = reply.to_str().unwrap();
        let _ = std::fs::remove_file(&reply);
        assert!(!is_waiting(r));
        std::fs::write(with_suffix(&reply, ".waiting"), "999999999").unwrap();
        assert!(is_waiting(r), "fresh marker counts as waiting");
        write_reply(r, "first\n").unwrap();
        write_reply(r, "second").unwrap();
        assert_eq!(
            std::fs::read_to_string(&reply).unwrap(),
            "first\n\n---\n\nsecond\n"
        );
        let _ = std::fs::remove_dir_all(d.parent().unwrap());
    }
}
