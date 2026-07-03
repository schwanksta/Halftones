mod menu;
mod startup;

use tauri::{Emitter, Manager};
use startup::StartupFiles;

/// Set a custom Finder icon on the saved .halftones file (macOS only).
/// Best-effort: failures are logged, never surfaced to the caller.
#[tauri::command]
fn set_file_icon(app: tauri::AppHandle, path: String, png: Vec<u8>) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(move || {
            use objc2::AnyThread;
            use objc2_app_kit::{NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
            use objc2_foundation::{NSData, NSString};
            let data = NSData::with_bytes(&png);
            if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
                let ws = NSWorkspace::sharedWorkspace();
                let ns_path = NSString::from_str(&path);
                let _ = ws.setIcon_forFile_options(
                    Some(&image),
                    &ns_path,
                    NSWorkspaceIconCreationOptions::empty(),
                );
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, path, png);
    }
}

#[tauri::command]
fn confirm_close(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        win.destroy().ok();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(StartupFiles(std::sync::Mutex::new(vec![])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let menu = menu::build_app_menu(&app.handle())?;
            app.set_menu(menu)?;

            // Intercept the native close button / Cmd+Q / Quit menu.
            // We veto every close and emit an event so JS can show a save prompt.
            let win = app.get_webview_window("main").unwrap();
            win.on_window_event({
                let app_handle = app.handle().clone();
                move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = app_handle.emit("close-requested", ());
                    }
                }
            });

            Ok(())
        })
        .on_menu_event(menu::on_menu_event)
        .invoke_handler(tauri::generate_handler![
            menu::set_recent_menu,
            startup::take_startup_files,
            confirm_close,
            set_file_icon,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Opened { urls } = event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            if !paths.is_empty() {
                // Buffer first — JS drains this on startup via take_startup_files
                if let Some(state) = app_handle.try_state::<StartupFiles>() {
                    state.0.lock().unwrap().extend(paths.clone());
                }
                // Also emit for warm-reopen (when JS is already loaded)
                let _ = app_handle.emit("file-opened", paths);
            }
        }
    });
}
