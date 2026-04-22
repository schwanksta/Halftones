use std::sync::Mutex;

// ─── Startup file buffer ──────────────────────────────────────────────────────
// RunEvent::Opened may fire before the JS runtime is ready to receive events.
// We buffer the paths here and let JS drain them via take_startup_files once
// the webview is initialised.

pub struct StartupFiles(pub Mutex<Vec<String>>);

#[tauri::command]
pub fn take_startup_files(state: tauri::State<StartupFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}
