# Instructions pour les agents IA (Tauri Client)

**IMPORTANT: GESTION DES VERSIONS**

Chaque fois que tu (l'agent IA) modifies un ou plusieurs fichiers liés au client Tauri (situés dans ce dossier `client/` ou ses sous-dossiers), **tu dois IMPÉRATIVEMENT incrémenter le numéro de version (bump)** de l'application avant de finaliser tes changements.

La version doit être mise à jour de manière identique dans ces trois fichiers :
1. `client/package.json`
2. `client/src-tauri/tauri.conf.json`
3. `client/src-tauri/Cargo.toml`

L'incrémentation doit suivre le versionnement sémantique (SemVer : `Major.Minor.Patch`). En général, une modification ou un ajout mineur nécessite d'incrémenter le `Patch` (ex: `1.0.1` -> `1.0.2`).

Cette règle est absolue car le système de déploiement GitHub Actions utilise le numéro de version de `package.json` pour taguer et nommer les nouvelles Releases publiées sur GitHub. Si tu oublies de changer la version, les utilisateurs existants ne recevront pas la notification de mise à jour (l'overlay vérifiera la version locale et ne verra pas de différence).