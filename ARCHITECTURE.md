# 🗂️ Arborescence BordelBox

```
bordelbox/
│
├── .env.example                    ← Variables d'env à copier en .env
├── .gitignore
├── README.md
│
├── server/                         ── 🖥️  SERVEUR NODE.JS
│   ├── package.json
│   ├── server.js                   ← Point d'entrée : Express + Socket.io + Queue
│   └── public/                     ← Servi sous /panel (Panel Web) et /media
│       ├── index.html              ← SPA du Panel d'administration
│       ├── css/
│       │   └── panel.css
│       ├── js/
│       │   └── panel.js
│       └── media/                  ← Vidéos téléchargées par yt-dlp (gitignored)
│
├── discord-bot/                    ── 🤖  BOT DISCORD
│   ├── package.json
│   ├── index.js                    ← Bot principal : Slash Commands + Rich Presence
│   └── deploy-commands.js          ← Script d'enregistrement des commandes (1x)
│
└── client/                         ── 🪟  CLIENT TAURI (overlay)
    ├── package.json
    ├── src/
    │   ├── index.html              ← Overlay HTML transparent
    │   ├── main.js                 ← Logique Socket.io + affichage
    │   └── config.json             ← Pseudo + URL serveur (éditer sur chaque PC)
    └── src-tauri/
        ├── Cargo.toml
        ├── tauri.conf.json         ← Config fenêtre : transparent, alwaysOnTop
        ├── capabilities/
        │   └── default.json        ← Permissions Tauri v2
        └── src/
            ├── main.rs             ← Entry point Rust
            └── lib.rs              ← Click-through Win32 + commande Tauri
```

## Flux de données

```
[Discord /sendurl]                    [Panel Web POST /api/sendurl]
         │                                         │
         ▼                                         ▼
    [Bot → POST /api/sendurl]               [Express route]
                    │                             │
                    ▼                             ▼
              [server.js : downloadMedia() via yt-dlp]
                              │
                              ▼
                    [enqueue(target, item)]
                              │
                    ┌─────────┴─────────┐
                    │                   │
                  target=all          target=pseudo
                    │                   │
             pour chaque client       1 seul client
                    │                   │
                    ▼                   ▼
              [flushQueue(pseudo)] si non busy
                    │
                    ▼
          [Socket.io → emit('show', item)] vers le client
                    │
                    ▼
          [Client Tauri : showItem(item)]
          ─ vidéo  : lecture via <video>
          ─ image  : affichage 5s
          ─ audio  : lecture via <audio>
          ─ message: texte animé, durée auto
                    │
                    ▼
          [Client → emit('media_ended')]
                    │
                    ▼
          [server.js : client.busy = false → flushQueue()]
                    │
                    ▼
          [Prochain item en queue, ou attente]
```
