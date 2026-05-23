use std::fs;
use std::io::Write;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::Manager;

tauri_nspanel::tauri_panel! {
    panel!(MainPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

// ============================================================
// 数据模型
// ============================================================
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredCommand {
    id: String,
    name: String,
    cmd: String,
    #[serde(default)]
    desc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredPath {
    id: String,
    #[serde(default)]
    name: String,
    path: String,
    #[serde(default)]
    desc: String,
}

/// 兼容旧版 paths: ["/foo", "/bar"] 也兼容新版 [{id, name, path, desc}]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum PathEntry {
    Legacy(String),
    Full(StoredPath),
}

impl PathEntry {
    fn into_stored(self) -> StoredPath {
        match self {
            PathEntry::Full(p) => p,
            PathEntry::Legacy(s) => StoredPath {
                id: gen_id(),
                name: String::new(),
                path: s,
                desc: String::new(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppData {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    commands: Vec<StoredCommand>,
    #[serde(default)]
    paths: Vec<PathEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppDataNormalized {
    version: u32,
    commands: Vec<StoredCommand>,
    paths: Vec<StoredPath>,
}

fn default_version() -> u32 { 1 }

fn gen_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("p{:x}", nanos)
}

fn default_commands() -> Vec<StoredCommand> {
    vec![
        StoredCommand { id: "mkdir".into(),    name: "mkdir".into(),        cmd: "mkdir".into(),        desc: "创建目录（需配合参数）".into() },
        StoredCommand { id: "cd".into(),       name: "cd".into(),           cmd: "cd".into(),           desc: "切换目录（需配合路径）".into() },
        StoredCommand { id: "pwd".into(),      name: "pwd".into(),          cmd: "pwd".into(),          desc: "显示当前工作目录".into() },
        StoredCommand { id: "open".into(),     name: "open .".into(),       cmd: "open .".into(),       desc: "用 Finder 打开当前目录".into() },
        StoredCommand { id: "grep".into(),     name: "grep".into(),         cmd: "grep".into(),         desc: "文本搜索（需配合参数）".into() },
        StoredCommand { id: "treefind".into(), name: "treelike find".into(),
            cmd: r#"find . -print | sed -e 's;[^/]*/;|____;g;s;____|; |;g'"#.into(),
            desc: "树状显示当前目录结构".into() },
    ]
}

// ============================================================
// AppleScript 字符串转义
// ============================================================
fn escape_for_applescript(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

// ============================================================
// 执行命令
// ============================================================
#[tauri::command]
async fn execute_command(cmd: String) -> Result<(), String> {
    let clean_cmd = cmd.trim();
    if clean_cmd.is_empty() {
        return Err("命令不能为空".to_string());
    }

    if let Ok(mut pbcopy) = std::process::Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
    {
        if let Some(mut stdin) = pbcopy.stdin.take() {
            let _ = stdin.write_all(clean_cmd.as_bytes());
        }
        let _ = pbcopy.wait();
    }

    let escaped = escape_for_applescript(clean_cmd);
    let script = format!(
        r#"
        tell application "Terminal"
            activate
            if (count of windows) is 0 then
                do script "{cmd}"
            else
                do script "{cmd}" in front window
            end if
        end tell
        "#,
        cmd = escaped
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("osascript 启动失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("Terminal 执行失败: {}", stderr));
    }
    Ok(())
}

// ============================================================
// 获取 Terminal 当前路径（精简版）
// ============================================================
#[tauri::command]
async fn get_current_terminal_path() -> Result<String, String> {
    // 1. 检查 Terminal 是否在运行
    let check_running = std::process::Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events" to (name of processes) contains "Terminal""#)
        .output()
        .map_err(|e| format!("无法检查 Terminal 状态: {}", e))?;

    let running = String::from_utf8_lossy(&check_running.stdout).trim().to_string();
    if running != "true" {
        return Err("Terminal 未启动，请先打开 Terminal.app".to_string());
    }

    // 2. 取 tty
    let tty_script = r#"
        tell application "Terminal"
            if (count of windows) is 0 then
                return "ERR_NO_WINDOW"
            end if
            try
                return tty of selected tab of front window
            on error errMsg
                return "ERR_SCRIPT:" & errMsg
            end try
        end tell
    "#;

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(tty_script)
        .output()
        .map_err(|e| format!("osascript 执行失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.contains("1743") || stderr.to_lowercase().contains("not authorized") {
            return Err("自动化权限被拒绝，请到 系统设置 → 隐私与安全性 → 自动化 中允许".to_string());
        }
        return Err(format!("AppleScript 错误: {}", stderr));
    }

    let tty_full = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if tty_full == "ERR_NO_WINDOW" {
        return Err("Terminal 没有打开的窗口".to_string());
    }
    if tty_full.starts_with("ERR_SCRIPT:") {
        return Err(format!("AppleScript 内部错误: {}", &tty_full[11..]));
    }
    if tty_full.is_empty() {
        return Err("无法读取 Terminal 设备路径".to_string());
    }

    let tty_short = tty_full.trim_start_matches("/dev/");

    // 3. 查找 shell 进程 PID
    let shell_pid_cmd = format!(
        r#"ps -t {tty} -o pid=,command= 2>/dev/null | awk '/(^| |\/)(bash|zsh|fish|sh|dash|tcsh|ksh)( |$)/{{pid=$1}} END{{print pid}}'"#,
        tty = tty_short
    );

    let pid_out = std::process::Command::new("sh")
        .arg("-c")
        .arg(&shell_pid_cmd)
        .output()
        .map_err(|e| format!("查找 shell 进程失败: {}", e))?;

    let pid = String::from_utf8_lossy(&pid_out.stdout).trim().to_string();

    if pid.is_empty() {
        let any_pid_cmd = format!(
            r#"ps -t {tty} -o pid= 2>/dev/null | tail -1 | tr -d ' '"#,
            tty = tty_short
        );
        let any_pid_out = std::process::Command::new("sh")
            .arg("-c")
            .arg(&any_pid_cmd)
            .output()
            .map_err(|e| format!("查找进程失败: {}", e))?;
        let any_pid = String::from_utf8_lossy(&any_pid_out.stdout).trim().to_string();
        if any_pid.is_empty() {
            return Err(format!("tty {} 上没有任何进程", tty_full));
        }
        return read_cwd_of_pid(&any_pid, &tty_full);
    }

    read_cwd_of_pid(&pid, &tty_full)
}

fn read_cwd_of_pid(pid: &str, tty: &str) -> Result<String, String> {
    let lsof_cmd = format!(
        r#"lsof -a -d cwd -Fn -p {pid} 2>/dev/null | awk '/^n/{{sub(/^n/,""); print; exit}}'"#,
        pid = pid
    );
    let cwd_output = std::process::Command::new("sh")
        .arg("-c")
        .arg(&lsof_cmd)
        .output()
        .map_err(|e| format!("反查 cwd 失败: {}", e))?;

    let cwd = String::from_utf8_lossy(&cwd_output.stdout).trim().to_string();

    if cwd.is_empty() || !cwd.starts_with('/') {
        return Err(format!("无法获取 PID {} 的工作目录（tty {}）", pid, tty));
    }
    Ok(cwd)
}

// ============================================================
// 数据持久化：data.json
// ============================================================
fn data_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位 app data 目录: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {}", e))?;
    Ok(dir.join("data.json"))
}

fn normalize(data: AppData) -> AppDataNormalized {
    AppDataNormalized {
        version: 1,
        commands: data.commands,
        paths: data.paths.into_iter().map(|p| p.into_stored()).collect(),
    }
}

#[tauri::command]
async fn load_data(app: tauri::AppHandle) -> Result<AppDataNormalized, String> {
    let file = data_file(&app)?;
    if !file.exists() {
        let initial = AppDataNormalized {
            version: 1,
            commands: default_commands(),
            paths: vec![],
        };
        let json = serde_json::to_string_pretty(&initial)
            .map_err(|e| format!("初始化序列化失败: {}", e))?;
        fs::write(&file, json).map_err(|e| format!("写入初始数据失败: {}", e))?;
        return Ok(initial);
    }
    let raw = fs::read_to_string(&file).map_err(|e| format!("读取失败: {}", e))?;
    let parsed: AppData =
        serde_json::from_str(&raw).map_err(|e| format!("解析 data.json 失败: {}", e))?;
    Ok(normalize(parsed))
}

#[tauri::command]
async fn save_data(app: tauri::AppHandle, data: AppDataNormalized) -> Result<(), String> {
    let file = data_file(&app)?;
    let json = serde_json::to_string_pretty(&data).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&file, json).map_err(|e| format!("写入失败: {}", e))?;
    Ok(())
}

// ============================================================
// 入口
// ============================================================
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_nspanel::init())
        .invoke_handler(tauri::generate_handler![
            execute_command,
            get_current_terminal_path,
            load_data,
            save_data
        ])
        .setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let _window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into())
            )
            .title("CLI-C")
            .inner_size(305.0, 420.0)
            .always_on_top(true)
            .decorations(true)  // 保留标题栏
            .visible(true)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}