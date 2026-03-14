# 🗂️ Arborescence BordelBox

## 🎙️ Option TTS (Text-to-Speech)

BordelBox prend en charge l'option TTS lors de l'envoi de médias ou de messages (via `/sendurl`, `/sendfile` ou `/message`). En fournissant le nom d'un modèle vocal, le serveur génère un fichier audio à partir de votre texte (caption ou message) qui sera joué en simultané sur le PC cible.

### Ajouter de nouveaux modèles TTS (Serveur Ubuntu)

Les modèles sont gérés directement sur le serveur Node.js. Voici comment en ajouter de nouveaux :

1. Sur votre serveur/VM (Ubuntu), rendez-vous dans le dossier d'installation de `BordelBox`.
2. Allez dans le répertoire `server/tts_models/` (si le dossier `tts_models` n'existe pas, créez-le).
3. Créez un dossier pour votre nouveau modèle, par exemple `mon_modele` (sans espaces).
4. À l'intérieur de ce dossier, créez un fichier exécutable bash nommé `run.sh` (`run.bat` pour Windows).
5. Ce script doit prendre en charge deux arguments : le texte en argument 1 (`$1`) et le chemin de sortie audio en argument 2 (`$2`).

**Exemple de `server/tts_models/robot/run.sh` :**
```bash
#!/bin/bash
TEXT=$1
OUTPUT_PATH=$2

# Exemple utilisant un outil en ligne de commande comme espeak ou edge-tts
# espeak -v fr -w "$OUTPUT_PATH" "$TEXT"
edge-tts --voice fr-FR-HenriNeural --text "$TEXT" --write-media "$OUTPUT_PATH"
```
6. N'oubliez pas de rendre le fichier exécutable sur votre VM Ubuntu : `chmod +x server/tts_models/robot/run.sh`.
7. Dans Discord, vous pourrez alors utiliser l'option `tts: "robot"` !
