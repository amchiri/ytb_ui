import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid

from flask import Flask, after_this_request, jsonify, render_template, request, send_file
from yt_dlp import YoutubeDL


app = Flask(__name__)
default_downloads_dir = os.path.join(os.getcwd(), "downloads")
DOWNLOADS_DIR = os.path.abspath(os.getenv("DOWNLOADS_DIR", default_downloads_dir).strip() or default_downloads_dir)
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

jobs = {}
jobs_lock = threading.Lock()


def build_command(url, mode, output_template, output_path):
    command = [sys.executable, "-m", "yt_dlp", "--no-warnings"]

    if mode == "mp3_advanced":
        command.extend(
            [
                "-x",
                "--audio-format",
                "mp3",
                "--audio-quality",
                "0",
                "--embed-metadata",
                "--embed-thumbnail",
                "--convert-thumbnails",
                "jpg",
                "--parse-metadata",
                "uploader:%(artist)s",
                "-o",
                "%(artist,uploader)s - %(title)s.%(ext)s",
            ]
        )
    elif mode == "mp3_simple":
        command.extend(["-x", "--audio-format", "mp3", "--audio-quality", "0"])
        if output_template:
            command.extend(["-o", output_template])
    elif mode == "mp4":
        command.extend(["-f", "mp4"])
        if output_template:
            command.extend(["-o", output_template])
    elif mode == "raw":
        # Mode simple sans aucune transformation (pas besoin de ffmpeg)
        command.extend(["-f", "bestvideo+bestaudio/best"])
        if output_template:
            command.extend(["-o", output_template])
    else:
        raise ValueError("Invalid mode")

    command.extend(["-P", output_path, url])
    return command


def append_log(job_id, message):
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id]["logs"].append(message)


def set_job_state(job_id, **kwargs):
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(kwargs)


def run_download(job_id, command):
    try:
        append_log(job_id, "Command started:")
        append_log(job_id, " ".join(command))
        append_log(job_id, "-" * 72)

        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )

        set_job_state(job_id, status="running", pid=process.pid)

        assert process.stdout is not None
        for line in process.stdout:
            append_log(job_id, line.rstrip())

        code = process.wait()
        if code == 0:
            append_log(job_id, "Download completed successfully.")
            set_job_state(job_id, status="done", return_code=code)
        else:
            append_log(job_id, f"Download failed with exit code {code}.")
            set_job_state(job_id, status="error", return_code=code)
    except FileNotFoundError:
        append_log(job_id, "Error: yt_dlp module not found in this Python environment.")
        set_job_state(job_id, status="error", return_code=-1)
    except Exception as exc:
        append_log(job_id, f"Unexpected error: {exc}")
        set_job_state(job_id, status="error", return_code=-1)


def pick_downloaded_file(root_dir):
    candidates = []
    for dir_path, _, file_names in os.walk(root_dir):
        for file_name in file_names:
            lower_name = file_name.lower()
            if lower_name.endswith(".part") or lower_name.endswith(".ytdl"):
                continue
            full_path = os.path.join(dir_path, file_name)
            candidates.append(full_path)

    if not candidates:
        return None

    candidates.sort(key=os.path.getmtime, reverse=True)
    return candidates[0]


def normalize_search_entries(result):
    entries = result.get("entries") or []
    items = []

    for entry in entries:
        if not entry:
            continue
        video_id = entry.get("id")
        if not video_id:
            continue

        thumbnail = entry.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

        items.append(
            {
                "id": video_id,
                "title": entry.get("title") or "Untitled",
                "uploader": entry.get("uploader") or "Unknown channel",
                "duration": entry.get("duration") or 0,
                "views": entry.get("view_count") or 0,
                "thumbnail": thumbnail,
                "url": f"https://www.youtube.com/watch?v={video_id}",
            }
        )

    return items


@app.route("/")
def home():
    return render_template("index.html")


@app.post("/api/search")
def api_search():
    payload = request.get_json(silent=True) or {}
    query = (payload.get("query") or "").strip()

    if not query:
        return jsonify({"error": "Query is required"}), 400

    options = {
        "quiet": True,
        "skip_download": True,
        "extract_flat": True,
        "noplaylist": True,
    }

    try:
        with YoutubeDL(options) as ydl:
            result = ydl.extract_info(f"ytsearch12:{query}", download=False)
        return jsonify({"items": normalize_search_entries(result)})
    except Exception as exc:
        return jsonify({"error": f"Search failed: {exc}"}), 500


@app.post("/api/download")
def api_download():
    payload = request.get_json(silent=True) or {}
    source_url = (payload.get("url") or "").strip()
    mode = (payload.get("mode") or "mp3_advanced").strip()
    output_template = (payload.get("output_template") or "").strip()

    if not source_url:
        return jsonify({"error": "URL is required"}), 400

    os.makedirs(DOWNLOADS_DIR, exist_ok=True)

    try:
        command = build_command(source_url, mode, output_template, DOWNLOADS_DIR)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "return_code": None,
            "pid": None,
            "logs": [],
        }

    thread = threading.Thread(target=run_download, args=(job_id, command), daemon=True)
    thread.start()

    return jsonify({"job_id": job_id, "status": "queued"})


@app.post("/api/download-blob")
def api_download_blob():
    payload = request.get_json(silent=True) or {}
    source_url = (payload.get("url") or "").strip()
    mode = (payload.get("mode") or "mp3_advanced").strip()
    output_template = (payload.get("output_template") or "").strip()

    if not source_url:
        return jsonify({"error": "URL is required"}), 400

    temp_dir = tempfile.mkdtemp(prefix="ytb_blob_")

    try:
        blob_template = output_template or "%(title)s.%(ext)s"
        command = build_command(source_url, mode, blob_template, temp_dir)

        process = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

        if process.returncode != 0:
            shutil.rmtree(temp_dir, ignore_errors=True)
            return jsonify(
                {
                    "error": "Blob download failed",
                    "logs": process.stdout,
                    "return_code": process.returncode,
                }
            ), 500

        file_path = pick_downloaded_file(temp_dir)
        if not file_path:
            shutil.rmtree(temp_dir, ignore_errors=True)
            return jsonify({"error": "No output file was produced"}), 500

        file_name = os.path.basename(file_path)

        @after_this_request
        def cleanup_download_file(response):
            shutil.rmtree(temp_dir, ignore_errors=True)
            return response

        return send_file(file_path, as_attachment=True, download_name=file_name)
    except FileNotFoundError:
        shutil.rmtree(temp_dir, ignore_errors=True)
        return jsonify({"error": "yt_dlp module not found in this Python environment"}), 500
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        return jsonify({"error": f"Unexpected blob error: {exc}"}), 500


@app.get("/api/job/<job_id>")
def api_job(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        return jsonify(job)


@app.post("/api/clear-jobs")
def api_clear_jobs():
    with jobs_lock:
        jobs.clear()
    return jsonify({"status": "cleared"})


if __name__ == "__main__":
    print(f"--- YTB Studio Starting ---")
    print(f"Downloads directory: {DOWNLOADS_DIR}")
    app.run(host="0.0.0.0", port=8000, debug=False)
