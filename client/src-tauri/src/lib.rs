// BordelBox — Tauri backend
// Tray + Click-through + Options + Raccourcis clavier

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewWindow,
};

// ─── Win32 click-through ────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod win_clickthrough {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos,
        GWL_EXSTYLE, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_NOACTIVATE, WS_EX_LAYERED,
        WS_EX_TRANSPARENT, WS_EX_TOOLWINDOW,
    };

    pub fn enable(hwnd: isize) {
        unsafe {
            let hwnd = HWND(hwnd as *mut _);
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            // On ajoute aussi WS_EX_TOOLWINDOW pour cacher de l'Alt-Tab et s'assurer
            // que c'est bien une fenêtre "overlay", ce qui aide avec certains jeux en plein écran.
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE,
                ex | WS_EX_LAYERED.0 as isize | WS_EX_TRANSPARENT.0 as isize | WS_EX_TOOLWINDOW.0 as isize);

            // Force l'affichage en TOPMOST par-dessus le reste
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
            );
        }
    }
    pub fn disable(hwnd: isize) {
        unsafe {
            let hwnd = HWND(hwnd as *mut _);
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE,
                ex & !(WS_EX_TRANSPARENT.0 as isize));

            // Force l'affichage en TOPMOST même quand on désactive le click-through
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
            );
        }
    }
}

// ─── Commandes Tauri ────────────────────────────────────────────────────────
use std::sync::Mutex;

struct TrayMenuState {
    menu: Mutex<Option<Menu<tauri::Wry>>>,
}

#[tauri::command]
fn update_tray_menu(state: tauri::State<'_, TrayMenuState>, overlay_enabled: bool, is_muted: bool) {
    if let Some(menu) = state.menu.lock().unwrap().as_ref() {
        if let Some(mute_item) = menu.get("mute") {
            if let Some(item) = mute_item.as_menuitem() {
                let _ = item.set_text(if is_muted { "🔊 Activer le son" } else { "🔇 Désactiver le son" });
                let _ = item.set_enabled(overlay_enabled);
            }
        }
        if let Some(disable_item) = menu.get("disable") {
            if let Some(item) = disable_item.as_menuitem() {
                let _ = item.set_text(if overlay_enabled { "👁  Désactiver l'overlay" } else { "👁  Activer l'overlay" });
            }
        }
    }
}

#[tauri::command]
fn set_clickthrough(window: WebviewWindow, enabled: bool) {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::HasWindowHandle;
        use raw_window_handle::RawWindowHandle;
        if let Ok(handle) = window.window_handle() {
            if let RawWindowHandle::Win32(h) = handle.as_raw() {
                let hwnd = h.hwnd.get() as isize;
                if enabled { win_clickthrough::enable(hwnd); }
                else        { win_clickthrough::disable(hwnd); }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (window, enabled);
}

/// Sauvegarde config.json à côté du .exe et notifie l'overlay
#[tauri::command]
fn save_and_notify(app: AppHandle, config_json: String) -> Result<(), String> {
    let path = config_path()?;
    std::fs::write(&path, &config_json).map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.emit("config_updated", &config_json);
    }
    Ok(())
}

/// Lit config.json — retourne la config par défaut si absent
#[tauri::command]
fn load_config() -> String {
    config_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_else(|| {
            r#"{"pseudo":"CHANGE_MOI","serverUrl":"http://141.145.200.136:8123","textSize":100,"mediaSize":80,"muted":true}"#.to_string()
        })
}

fn config_path() -> Result<std::path::PathBuf, String> {
    // Utilise %APPDATA%\BordelBox\config.json sur Windows
    // (~/.config/BordelBox/config.json sur Linux/Mac)
    let base = dirs::config_dir()
        .ok_or_else(|| "Impossible de trouver le dossier config".to_string())?;
    let dir = base.join("BordelBox");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

// ─── Point d'entrée ─────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .manage(TrayMenuState { menu: Mutex::new(None) })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            update_tray_menu,
            set_clickthrough,
            save_and_notify,
            load_config,
        ])
        .setup(|app| {
            // ── Tray icon ───────────────────────────────────────────
            let i_options = MenuItem::with_id(app, "options", "⚙️  Options",              true, None::<&str>)?;
            let i_mute    = MenuItem::with_id(app, "mute",    "🔇 Désactiver le son",     true, None::<&str>)?;
            let i_disable = MenuItem::with_id(app, "disable", "👁  Désactiver l'overlay", true, None::<&str>)?;
            let i_quit    = MenuItem::with_id(app, "quit",    "❌ Quitter BordelBox",         true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&i_options, &i_mute, &i_disable, &i_quit])?;

            let state = app.state::<TrayMenuState>();
            *state.menu.lock().unwrap() = Some(menu.clone());

            TrayIconBuilder::with_id("main_tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("BordelBox Overlay")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "mute" => {
                        if let Some(w) = app.get_webview_window("overlay") {
                            let _ = w.emit("toggle_mute", ());
                        }
                    }
                    "disable" => {
                        if let Some(w) = app.get_webview_window("overlay") {
                            let _ = w.emit("toggle_overlay", ());
                        }
                    }
                    "options" => {
                        if let Some(w) = app.get_webview_window("options") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // ── Click-through overlay ───────────────────────────────
            #[cfg(target_os = "windows")]
            {
                let w = app.get_webview_window("overlay").unwrap();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    set_clickthrough(w, true);
                });
            }

            // ── Empêcher la destruction de la fenêtre Options ───────
            if let Some(opts) = app.get_webview_window("options") {
                let opts_clone = opts.clone();
                opts.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Annule la fermeture native (destruction)
                        api.prevent_close();
                        // Cache simplement la fenêtre
                        let _ = opts_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Erreur lors du lancement de BordelBox");
}
