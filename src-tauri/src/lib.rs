mod menu;

use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let menu = menu::build_app_menu(&app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(menu::on_menu_event)
        .invoke_handler(tauri::generate_handler![menu::set_recent_menu])
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
                let _ = app_handle.emit("file-opened", paths);
            }
        }
    });
}
