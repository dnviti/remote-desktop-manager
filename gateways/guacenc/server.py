"""Async HTTP microservice for converting recordings to video.

Supports two conversion pipelines:
  1. .guac → .m4v via guacenc (RDP/VNC recordings)
  2. .cast → .mp4 via agg + ffmpeg (SSH asciicast recordings)

Endpoints:
  GET  /health            — Enhanced health check with uptime and job stats
  POST /convert           — Submit async guac→m4v conversion job (returns 202 with jobId)
  POST /convert-asciicast — Submit async cast→mp4 conversion job (returns 202 with jobId)
  GET  /status/<id>       — Poll job status (pending → converting → complete/error)
  GET  /conversions       — List all in-memory jobs
  DELETE /cache           — Delete a specific cached video file (.m4v or .mp4)
  POST /cleanup           — Bulk-delete old video files from /recordings/
"""

import json
import os
import subprocess
import threading
import time
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler

# ── Configuration ────────────────────────────────────────────────────

PORT = int(os.environ.get("PORT", "3003"))
ALLOWED_PREFIX = "/recordings/"
GUACENC_TIMEOUT = int(os.environ.get("GUACENC_TIMEOUT", "300"))
JOB_EXPIRY_SECONDS = int(os.environ.get("JOB_EXPIRY_SECONDS", "3600"))
MAX_CONCURRENT_JOBS = int(os.environ.get("MAX_CONCURRENT_JOBS", "4"))
ASCIICAST_TIMEOUT = int(os.environ.get("ASCIICAST_TIMEOUT", "300"))
AGG_FONT_SIZE = int(os.environ.get("AGG_FONT_SIZE", "14"))
AGG_THEME = os.environ.get("AGG_THEME", "monokai")
CLEANUP_DEFAULT_MAX_AGE_DAYS = 90

START_TIME = time.monotonic()


# ── Job Store ────────────────────────────────────────────────────────

class JobStore:
    """Thread-safe in-memory store for conversion jobs."""

    def __init__(self):
        self._lock = threading.Lock()
        self._jobs: dict[str, dict] = {}
        self._total_processed: int = 0

    def create_job(self, file_path: str, resolution: str) -> str:
        with self._lock:
            self._cleanup_expired()
            active = self._active_count()
            if active >= MAX_CONCURRENT_JOBS:
                raise ValueError(f"too many active conversions ({active})")
            job_id = uuid.uuid4().hex
            self._jobs[job_id] = {
                "jobId": job_id,
                "status": "pending",
                "filePath": file_path,
                "resolution": resolution,
                "createdAt": time.time(),
                "completedAt": None,
                "outputPath": None,
                "fileSize": None,
                "error": None,
                "detail": None,
                "returncode": None,
            }
            self._total_processed += 1
            return job_id

    def get_job(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def update_status(self, job_id: str, status: str, **kwargs):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job["status"] = status
            for k, v in kwargs.items():
                job[k] = v
            if status in ("complete", "error"):
                job["completedAt"] = time.time()

    def list_jobs(self) -> list[dict]:
        with self._lock:
            self._cleanup_expired()
            return [dict(j) for j in self._jobs.values()]

    def active_count(self) -> int:
        with self._lock:
            return self._active_count()

    def total_processed(self) -> int:
        with self._lock:
            return self._total_processed

    def _active_count(self) -> int:
        return sum(1 for j in self._jobs.values() if j["status"] in ("pending", "converting"))

    def _cleanup_expired(self):
        now = time.time()
        expired = [
            jid for jid, j in self._jobs.items()
            if j["completedAt"] is not None and (now - j["completedAt"]) > JOB_EXPIRY_SECONDS
        ]
        for jid in expired:
            del self._jobs[jid]


# ── Conversion Worker ────────────────────────────────────────────────

def run_conversion(job_store: JobStore, job_id: str, file_path: str, resolution: str):
    """Run guacenc in a background thread and update job status."""
    job_store.update_status(job_id, "converting")
    cmd = ["guacenc", "-s", resolution, file_path]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=GUACENC_TIMEOUT)
        output_path = file_path + ".m4v"

        if result.returncode != 0 or not os.path.isfile(output_path):
            stderr = result.stderr.strip() if result.stderr else "unknown error"
            job_store.update_status(
                job_id, "error",
                error="guacenc conversion failed",
                detail=stderr,
                returncode=result.returncode,
            )
        else:
            file_size = os.path.getsize(output_path)
            job_store.update_status(
                job_id, "complete",
                outputPath=output_path,
                fileSize=file_size,
            )
    except subprocess.TimeoutExpired:
        job_store.update_status(
            job_id, "error",
            error=f"guacenc timed out after {GUACENC_TIMEOUT}s",
            detail="",
            returncode=-1,
        )
    except Exception as e:
        job_store.update_status(
            job_id, "error",
            error="unexpected error",
            detail=str(e),
            returncode=-1,
        )


# ── Asciicast Conversion Worker ──────────────────────────────────────

def run_asciicast_conversion(job_store: JobStore, job_id: str, file_path: str, resolution: str):
    """Convert an asciicast (.cast) file to MP4 via agg (GIF) then ffmpeg (MP4).

    Pipeline: .cast → agg → .gif → ffmpeg → .mp4
    agg renders the terminal session as an animated GIF, then ffmpeg converts to MP4.
    """
    job_store.update_status(job_id, "converting")
    output_path = file_path + ".mp4"
    gif_path = file_path + ".gif"

    try:
        # Step 1: Render asciicast to GIF using agg
        agg_cmd = [
            "agg",
            "--font-size", str(AGG_FONT_SIZE),
            "--theme", AGG_THEME,
            file_path,
            gif_path,
        ]
        agg_result = subprocess.run(
            agg_cmd, capture_output=True, text=True, timeout=ASCIICAST_TIMEOUT,
        )
        if agg_result.returncode != 0 or not os.path.isfile(gif_path):
            stderr = agg_result.stderr.strip() if agg_result.stderr else "unknown error"
            job_store.update_status(
                job_id, "error",
                error="agg rendering failed",
                detail=stderr,
                returncode=agg_result.returncode,
            )
            return

        # Step 2: Convert GIF to MP4 using ffmpeg
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", gif_path,
            "-movflags", "+faststart",
            "-pix_fmt", "yuv420p",
            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            output_path,
        ]
        ffmpeg_result = subprocess.run(
            ffmpeg_cmd, capture_output=True, text=True, timeout=ASCIICAST_TIMEOUT,
        )

        # Clean up intermediate GIF
        try:
            os.unlink(gif_path)
        except OSError:
            pass

        if ffmpeg_result.returncode != 0 or not os.path.isfile(output_path):
            stderr = ffmpeg_result.stderr.strip() if ffmpeg_result.stderr else "unknown error"
            job_store.update_status(
                job_id, "error",
                error="ffmpeg conversion failed",
                detail=stderr,
                returncode=ffmpeg_result.returncode,
            )
        else:
            file_size = os.path.getsize(output_path)
            job_store.update_status(
                job_id, "complete",
                outputPath=output_path,
                fileSize=file_size,
            )
    except subprocess.TimeoutExpired:
        # Clean up intermediate GIF on timeout
        try:
            os.unlink(gif_path)
        except OSError:
            pass
        job_store.update_status(
            job_id, "error",
            error=f"asciicast conversion timed out after {ASCIICAST_TIMEOUT}s",
            detail="",
            returncode=-1,
        )
    except Exception as e:
        # Clean up intermediate GIF on unexpected error
        try:
            os.unlink(gif_path)
        except OSError:
            pass
        job_store.update_status(
            job_id, "error",
            error="unexpected error",
            detail=str(e),
            returncode=-1,
        )


# ── Cleanup Utility ──────────────────────────────────────────────────

def cleanup_video_files(max_age_days: int) -> dict:
    """Walk /recordings/ and delete .m4v and .mp4 video cache files older than max_age_days."""
    cutoff = time.time() - (max_age_days * 86400)
    deleted = 0
    errors = 0
    freed_bytes = 0

    video_extensions = (".m4v", ".mp4")
    for root, _dirs, files in os.walk(ALLOWED_PREFIX):
        for f in files:
            if not f.endswith(video_extensions):
                continue
            full_path = os.path.join(root, f)
            try:
                st = os.stat(full_path)
                if st.st_mtime < cutoff:
                    freed_bytes += st.st_size
                    os.unlink(full_path)
                    deleted += 1
            except OSError:
                errors += 1

    return {"deleted": deleted, "errors": errors, "freedBytes": freed_bytes}


# ── HTTP Handler ─────────────────────────────────────────────────────

class GuacencHandler(BaseHTTPRequestHandler):
    job_store: JobStore

    # ── Routing ──────────────────────────────────────────────────────

    def do_GET(self):
        if self.path == "/health":
            self._handle_health()
        elif self.path == "/conversions":
            self._handle_list_conversions()
        elif self.path.startswith("/status/"):
            job_id = self.path[len("/status/"):]
            self._handle_status(job_id)
        else:
            self._json_response(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/convert":
            self._handle_convert()
        elif self.path == "/convert-asciicast":
            self._handle_convert_asciicast()
        elif self.path == "/cleanup":
            self._handle_cleanup()
        else:
            self._json_response(404, {"error": "not found"})

    def do_DELETE(self):
        if self.path == "/cache":
            self._handle_delete_cache()
        else:
            self._json_response(404, {"error": "not found"})

    # ── Endpoint Handlers ────────────────────────────────────────────

    def _handle_health(self):
        uptime = round(time.monotonic() - START_TIME, 1)
        self._json_response(200, {
            "status": "ok",
            "uptime": uptime,
            "activeJobs": self.job_store.active_count(),
            "totalJobsProcessed": self.job_store.total_processed(),
        })

    def _handle_convert(self):
        body = self._read_json_body()
        if body is None:
            return

        file_path = body.get("filePath", "")
        width = body.get("width", 1024)
        height = body.get("height", 768)

        if not file_path or not file_path.startswith(ALLOWED_PREFIX):
            self._json_response(400, {"error": "filePath must start with /recordings/"})
            return

        if not os.path.isfile(file_path):
            self._json_response(404, {"error": f"source file not found: {file_path}"})
            return

        resolution = f"{width}x{height}"

        try:
            job_id = self.job_store.create_job(file_path, resolution)
        except ValueError as e:
            self._json_response(503, {
                "error": str(e),
                "activeJobs": self.job_store.active_count(),
            })
            return

        t = threading.Thread(
            target=run_conversion,
            args=(self.job_store, job_id, file_path, resolution),
            daemon=True,
        )
        t.start()

        self._json_response(202, {"jobId": job_id, "status": "pending"})

    def _handle_convert_asciicast(self):
        body = self._read_json_body()
        if body is None:
            return

        file_path = body.get("filePath", "")

        if not file_path or not file_path.startswith(ALLOWED_PREFIX):
            self._json_response(400, {"error": "filePath must start with /recordings/"})
            return

        if not os.path.isfile(file_path):
            self._json_response(404, {"error": f"source file not found: {file_path}"})
            return

        # Resolution not used by agg (it auto-detects from terminal size), but kept for API consistency
        resolution = "auto"

        try:
            job_id = self.job_store.create_job(file_path, resolution)
        except ValueError as e:
            self._json_response(503, {
                "error": str(e),
                "activeJobs": self.job_store.active_count(),
            })
            return

        t = threading.Thread(
            target=run_asciicast_conversion,
            args=(self.job_store, job_id, file_path, resolution),
            daemon=True,
        )
        t.start()

        self._json_response(202, {"jobId": job_id, "status": "pending"})

    def _handle_status(self, job_id: str):
        job = self.job_store.get_job(job_id)
        if not job:
            self._json_response(404, {"error": "job not found"})
            return

        response: dict = {"jobId": job["jobId"], "status": job["status"]}

        if job["status"] == "complete":
            response["outputPath"] = job["outputPath"]
            response["fileSize"] = job["fileSize"]
        elif job["status"] == "error":
            response["error"] = job["error"]
            response["detail"] = job["detail"]
            response["returncode"] = job["returncode"]

        self._json_response(200, response)

    def _handle_list_conversions(self):
        jobs = self.job_store.list_jobs()
        summary = [
            {
                "jobId": j["jobId"],
                "status": j["status"],
                "filePath": j["filePath"],
                "createdAt": j["createdAt"],
            }
            for j in jobs
        ]
        self._json_response(200, {"jobs": summary, "total": len(summary)})

    def _handle_delete_cache(self):
        body = self._read_json_body()
        if body is None:
            return

        file_path = body.get("filePath", "")
        if not file_path or not file_path.startswith(ALLOWED_PREFIX):
            self._json_response(400, {"error": "filePath must start with /recordings/"})
            return

        # Try .m4v (guac) first, then .mp4 (asciicast)
        video_path = None
        for ext in (".m4v", ".mp4"):
            candidate = file_path + ext
            if os.path.isfile(candidate):
                video_path = candidate
                break

        if not video_path:
            self._json_response(404, {"error": f"cached file not found for: {file_path}"})
            return

        try:
            os.unlink(video_path)
            self._json_response(200, {"deleted": True, "path": video_path})
        except OSError as e:
            self._json_response(500, {"error": f"failed to delete: {e}"})

    def _handle_cleanup(self):
        body = self._read_json_body()
        if body is None:
            return

        max_age_days = body.get("maxAgeDays", CLEANUP_DEFAULT_MAX_AGE_DAYS)
        if not isinstance(max_age_days, int) or max_age_days < 1:
            self._json_response(400, {"error": "maxAgeDays must be a positive integer"})
            return

        result = cleanup_video_files(max_age_days)
        self._json_response(200, result)

    # ── Helpers ──────────────────────────────────────────────────────

    def _read_json_body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length > 0 else {}
            return body
        except (json.JSONDecodeError, ValueError):
            self._json_response(400, {"error": "invalid JSON body"})
            return None

    def _json_response(self, status: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[guacenc] {fmt % args}")


# ── Main ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    job_store = JobStore()
    GuacencHandler.job_store = job_store

    server = HTTPServer(("0.0.0.0", PORT), GuacencHandler)
    print(f"[guacenc] Listening on port {PORT}")
    print(f"[guacenc] Max concurrent jobs: {MAX_CONCURRENT_JOBS}")
    print(f"[guacenc] Conversion timeout: {GUACENC_TIMEOUT}s")
    print(f"[guacenc] Job expiry: {JOB_EXPIRY_SECONDS}s")
    server.serve_forever()
