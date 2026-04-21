use std::sync::Mutex;

use tauri::{
    menu::{
        Menu, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder,
    },
    AppHandle, Emitter, Manager, Runtime,
};

// ─── Managed state for the Open Recent submenu ───────────────────────────────

pub struct RecentSubmenuState(pub Mutex<Submenu<tauri::Wry>>);

#[derive(serde::Deserialize)]
pub struct RecentMenuItem {
    pub path: String,
    pub name: String,
}

// ─── Build the full app menu ──────────────────────────────────────────────────

pub fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // ── App submenu (macOS app name menu) ──────────────────────────────────
    let app_submenu = SubmenuBuilder::new(app, "Halftones")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // ── Open Recent submenu (initial: single disabled placeholder) ─────────
    let no_recent = MenuItem::with_id(
        app,
        "noRecentProjects",
        "No Recent Projects",
        false,
        None::<&str>,
    )?;
    let open_recent_submenu = SubmenuBuilder::new(app, "Open Recent")
        .item(&no_recent)
        .build()?;

    // Store the submenu handle so set_recent_menu can mutate it later
    app.manage(RecentSubmenuState(Mutex::new(open_recent_submenu.clone())));

    // ── File submenu ───────────────────────────────────────────────────────
    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?)
        .item(&MenuItem::with_id(app, "open", "Open\u{2026}", true, Some("CmdOrCtrl+O"))?)
        .item(&open_recent_submenu)
        .item(&MenuItem::with_id(app, "close", "Close", true, Some("CmdOrCtrl+W"))?)
        .separator()
        .item(&MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?)
        .item(&MenuItem::with_id(app, "saveAs", "Save As\u{2026}", true, Some("CmdOrCtrl+Shift+S"))?)
        .separator()
        .item(&MenuItem::with_id(app, "exportPng", "Export PNG\u{2026}", true, Some("CmdOrCtrl+E"))?)
        .item(&MenuItem::with_id(
            app,
            "exportChannels",
            "Export Channels\u{2026}",
            true,
            Some("CmdOrCtrl+Shift+E"),
        )?)
        .item(&MenuItem::with_id(app, "exportPdf", "Export PDF\u{2026}", true, Some("CmdOrCtrl+P"))?)
        .item(&MenuItem::with_id(
            app,
            "exportProof",
            "Export Color Proof\u{2026}",
            true,
            None::<&str>,
        )?)
        .build()?;

    // ── Edit submenu (predefined system items) ─────────────────────────────
    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // ── View submenu ───────────────────────────────────────────────────────
    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(&MenuItem::with_id(app, "zoomIn", "Zoom In", true, Some("CmdOrCtrl+="))?)
        .item(&MenuItem::with_id(app, "zoomOut", "Zoom Out", true, Some("CmdOrCtrl+-"))?)
        .item(&MenuItem::with_id(app, "zoomFit", "Fit to Window", true, Some("CmdOrCtrl+0"))?)
        .item(&MenuItem::with_id(
            app,
            "zoomActual",
            "Actual Size (100%)",
            true,
            Some("CmdOrCtrl+1"),
        )?)
        .build()?;

    // ── Window submenu ─────────────────────────────────────────────────────
    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .build()?;

    // ── Help submenu (empty — macOS injects search field automatically) ────
    let help_submenu = SubmenuBuilder::new(app, "Help").build()?;

    // ── Assemble full menu bar ─────────────────────────────────────────────
    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .item(&help_submenu)
        .build()?;

    Ok(menu)
}

// ─── Menu event handler (registered via .on_menu_event) ──────────────────────

pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref().to_string();

    let payload = if let Some(path) = id.strip_prefix("openRecent:") {
        serde_json::json!({ "event": "openRecent", "payload": path })
    } else {
        serde_json::json!({ "event": id, "payload": null })
    };

    if let Err(e) = app.emit("menu-event", payload) {
        eprintln!("[halftones] Failed to emit menu-event: {e}");
    }
}

// ─── Tauri command: rebuild the Open Recent submenu ──────────────────────────

#[tauri::command]
pub fn set_recent_menu(
    app: tauri::AppHandle,
    items: Vec<RecentMenuItem>,
) -> Result<(), String> {
    let state = app
        .state::<RecentSubmenuState>();
    let submenu = state.0.lock().map_err(|e| e.to_string())?;

    // Remove all existing items by repeatedly removing index 0
    loop {
        match submenu.remove_at(0).map_err(|e| e.to_string())? {
            Some(_) => continue,
            None => break,
        }
    }

    if items.is_empty() {
        // Show disabled placeholder
        let placeholder = MenuItem::with_id(
            &app,
            "noRecentProjects",
            "No Recent Projects",
            false,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        submenu
            .append(&placeholder)
            .map_err(|e| e.to_string())?;
    } else {
        // Add one menu item per recent entry
        for entry in &items {
            let id = format!("openRecent:{}", entry.path);
            let item =
                MenuItem::with_id(&app, id, &entry.name, true, None::<&str>)
                    .map_err(|e| e.to_string())?;
            submenu.append(&item).map_err(|e| e.to_string())?;
        }

        // Separator + Clear Recent
        let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
        submenu.append(&sep).map_err(|e| e.to_string())?;

        let clear = MenuItem::with_id(&app, "clearRecent", "Clear Recent", true, None::<&str>)
            .map_err(|e| e.to_string())?;
        submenu.append(&clear).map_err(|e| e.to_string())?;
    }

    Ok(())
}
