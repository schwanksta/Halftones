mod menu;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
