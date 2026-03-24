# 🗂️ BordelBox

BordelBox is a system that allows users to send media, TTS messages, and interactive events from a Discord Bot or Web Dashboard directly to a transparent overlay on target PCs.

## ✨ Features

- **Media Sharing:** Send images, videos, and audio clips directly to a connected PC's screen.
- **Interactive Boss Events:** Participate in real-time Boss battles that scale with active clients and reward players with BordelCoins.
- **Economy System:** Earn BordelCoins, buy items, sell fish, and use visual filters to customize your messages.
- **AI Integration:** Chat with a sarcastic AI personality via Discord (supports Groq, OpenRouter, and Gemini).
- **TTS Messages:** Send Text-to-Speech messages natively with support for custom models.
- **User Profiles:** Customize your persistent visual profile with fonts, colors, and animations.
- **Memes & Reputation:** Save personal memes and manage reputation votes via a dedicated Discord channel.

## 🏗️ Architecture Overview

The system consists of three main components:
1. **Node.js Server (`server/`):** The core backend handling API requests, Socket.io real-time communication, media queueing, AI integration, economy logic, and serving the Web Dashboard.
2. **Discord Bot (`discord-bot/`):** The primary user interface allowing users to trigger events, send media, check stats, and interact with the AI using Slash Commands and buttons.
3. **Tauri Client (`client/`):** A lightweight, transparent desktop overlay (built with Rust & HTML/JS) that runs on the target PC (e.g., Lenovo V14 G4 laptops) to display media and events seamlessly above fullscreen applications.

---

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js** (v18+ recommended)
- **Rust and Cargo** (Required for the Tauri Client)
- **yt-dlp** and **FFmpeg** (Required by the server for downloading and processing media)
- **Ubuntu Dependencies** (If building the Tauri client on Linux):
  ```bash
  sudo apt install libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev
  ```

---

## ⚙️ Setup Instructions

### 1. Configuration (`.env`)

Copy the provided `.env.example` file to `.env` in the root directory and configure it:
```bash
cp .env.example .env
```
Fill in the required variables, particularly your Discord credentials (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`), the `PANEL_PASSWORD`, and at least one AI API key (`GROQ_API_KEY`, `OPENROUTER_API_KEY`, or `GEMINI_API_KEY`).

### 2. Node.js Server

The server handles media downloads, queue management, and the web panel API.

```bash
cd server/
npm install
npm start
```
*Note: The server includes an automatic public `/upload` page protected by Discord OAuth2. Ensure your `DISCORD_REDIRECT_URI` is correctly configured in the Discord Developer Portal.*

### 3. Discord Bot

The bot connects Discord slash commands to the Node.js backend.

```bash
cd discord-bot/
npm install

# Run this ONCE to register the slash commands with Discord
node deploy-commands.js

# Start the bot
npm start
```

### 4. Tauri Client (Overlay)

The client runs on the target PC to display incoming media and interactive events.

```bash
cd client/
npm install

# Edit client/src/config.json to set the target pseudo and the server URL

# Run the Tauri development server to test the overlay locally
npm run dev

# Or build the executable for deployment
npm run build
```

---

## 🎙️ Custom TTS Models (Advanced)

BordelBox supports custom TTS models executed natively by the server.

1. Go to `server/tts_models/` (create it if it doesn't exist).
2. Create a folder for your new model (e.g., `mon_modele`).
3. Inside, create an executable bash script named `run.sh` (or `run.bat`).
4. The script receives the input text as `$1` and the target output file path as `$2`.

**Example (`run.sh`):**
```bash
#!/bin/bash
TEXT=$1
OUTPUT_PATH=$2
# Example using edge-tts
edge-tts --voice fr-FR-HenriNeural --text "$TEXT" --write-media "$OUTPUT_PATH"
```
Make the script executable (`chmod +x run.sh`). You can now use the TTS option `tts: "mon_modele"` in Discord!
