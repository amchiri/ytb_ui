# YTB Studio 🚀

Un outil local pour rechercher et télécharger des vidéos/audios YouTube en utilisant `yt-dlp`.

## Fonctionnalités
- 🔍 Recherche intégrée YouTube.
- 🎵 Téléchargement MP3 avec métadonnées et miniature.
- 📺 Téléchargement MP4.
- 📦 Mode Blob (téléchargement direct via le navigateur).
- 🐳 Prêt pour Docker.

## Installation avec Docker (Recommandé)

1. **Build l'image :**
   ```bash
   docker build -t ytb-studio .
   ```

2. **Lancer le conteneur :**
   ```bash
   docker run -d -p 8000:8000 -v ${PWD}/downloads:/app/downloads --name ytb-studio ytb-studio
   ```
   *Note : Le dossier `/app/downloads` à l'intérieur du conteneur est lié à votre dossier `downloads` local.*

3. **Accéder à l'application :**
   Ouvrez [http://localhost:8000](http://localhost:8000) dans votre navigateur.

## Installation manuelle

1. Installez les dépendances :
   ```bash
   pip install -r requirements.txt
   ```
2. Installez `ffmpeg` sur votre système (nécessaire pour la conversion MP3).
3. Lancez l'application :
   ```bash
   python app.py
   ```

## Configuration Docker Compose

Vous pouvez aussi utiliser `docker-compose` pour une gestion plus simple :

```yaml
version: '3.8'
services:
  ytb-studio:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./downloads:/app/downloads
    restart: always
```

Lancer avec : `docker-compose up -d`
