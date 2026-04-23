import cv2
import os
import threading
import time
import sqlite3
import base64
import json
import numpy as np
import pandas as pd

from fastapi import FastAPI, HTTPException, Path, Response
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional, Dict
from queue import Queue, Full, Empty
try:
    from ultralytics import YOLO
except Exception:
    YOLO = None
try:
    from keras_facenet import FaceNet
except Exception:
    FaceNet = None
try:
    from deepface import DeepFace
except Exception:
    DeepFace = None
try:
    from scipy.spatial.distance import cosine
except Exception:
    # fallback simple distance if scipy not available
    def cosine(a, b):
        a = np.asarray(a)
        b = np.asarray(b)
        if np.linalg.norm(a) == 0 or np.linalg.norm(b) == 0:
            return 1.0
        return 1.0 - np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
from collections import defaultdict, Counter

# ================= CONFIG =================
YOLO_MODEL_PATH = "yolov8n-face.pt"
ATTENDANCE_DIR = "attendance_logs"
DB_PATH = "attendance.db"
INSIGHTS_AUDIO_DIR = os.path.join(ATTENDANCE_DIR, "lecture_insights_audio")

THRESHOLD = 0.35
VOTE_FRAMES = 15
IOU_THRESHOLD = 0.3
ATTENDANCE_WINDOW_MIN = 10

# Emotion detection tuning to avoid frame lag
EMOTION_DETECTION_ENABLED = True
EMOTION_CAPTURE_INTERVAL_SEC = 1.5
EMOTION_MIN_FACE_SIZE = 64
EMOTION_SUMMARY_BATCH_SIZE = 12
EMOTION_SUMMARY_FLUSH_SEC = 8.0
EMOTION_QUEUE_MAXSIZE = 128
EMOTION_WORKER_COUNT = 1
EMOTION_OVERLAY_TTL_SEC = 10.0

# Multi-Camera Configuration
# Key: camera_id (string, matches 'classroom' in DB)
# Value: OpenCV source (int for USB cam index, or RTSP URL string)
CAMERAS = {
    "C101": 0,
    #"C102": 0,
    # "C103": 0,  # Replace with real RTSP if needed
    # "C104": 0,
    # "C105": 0,
    # Add/remove cameras here as needed
}

os.makedirs(ATTENDANCE_DIR, exist_ok=True)
os.makedirs(INSIGHTS_AUDIO_DIR, exist_ok=True)


def ensure_lecture_insights_table():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lecture_voice_insights (
            insight_id INTEGER PRIMARY KEY AUTOINCREMENT,
            lecture_id INTEGER,
            lecture_name TEXT,
            camera_id TEXT,
            transcript TEXT,
            lecture_summary TEXT,
            key_topics_json TEXT,
            action_items_json TEXT,
            overall_emotion TEXT,
            emotion_timeline_json TEXT,
            emotion_disclaimer TEXT,
            audio_path TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    """)
    conn.commit()
    conn.close()


ensure_lecture_insights_table()


def ensure_student_emotions_table():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS student_emotions (
            emotion_id INTEGER PRIMARY KEY AUTOINCREMENT,
            lecture_id INTEGER NOT NULL,
            camera_id TEXT NOT NULL,
            student_id INTEGER,
            student_name TEXT,
            emotion TEXT,
            confidence REAL,
            is_known_student INTEGER DEFAULT 0,
            detected_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (lecture_id) REFERENCES lectures(lecture_id)
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS student_emotion_summaries (
            summary_id INTEGER PRIMARY KEY AUTOINCREMENT,
            lecture_id INTEGER NOT NULL,
            camera_id TEXT NOT NULL,
            sampling_time TEXT NOT NULL,
            total_students_detected INTEGER,
            emotion_distribution TEXT,
            dominant_emotion TEXT,
            avg_confidence REAL,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            UNIQUE (lecture_id, camera_id, sampling_time),
            FOREIGN KEY (lecture_id) REFERENCES lectures(lecture_id)
        )
    """)
    conn.commit()
    conn.close()


ensure_student_emotions_table()

# ================= FASTAPI =================
app = FastAPI(title="Multi-Camera Face Attendance Backend")

# Allow requests from the Next dev frontend
# During local development allow all origins so the Next.js dev server
# (or file:// served pages) can contact the API without CORS issues.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================= PER-CAMERA STATE =================
class CameraState:
    def __init__(self, source):
        self.source = source
        self.cap = None
        self.latest_frame = None
        self.annotated_frame = None
        self.frame_lock = threading.Lock()

        self.database = {}
        self.current_lecture = None
        self.current_attendance_end = None
        self.current_attendance_start = None
        self.current_lecture_id = None

        self.tracks = {}
        self.track_votes = defaultdict(list)
        self.track_id_counter = 0
        self.marked_students = set()

        self.manual_attendance = False

        # Disable auto after manual stop during the same window
        self.auto_disable_lecture_id = None
        self.auto_disable_until = None

        # Emotion detection tracking
        self.last_emotion_capture = {}  # {track_id: timestamp}
        self.emotion_data_for_summary = []  # List of emotions to aggregate
        self.latest_track_emotions = {}  # {track_id: {emotion, confidence, ts}}
        self.last_emotion_summary_flush = time.time()
        self.emotion_lock = threading.Lock()

camera_states: Dict[str, CameraState] = {cam_id: CameraState(source) for cam_id, source in CAMERAS.items()}
emotion_job_queue: Queue = Queue(maxsize=EMOTION_QUEUE_MAXSIZE)

# ================= SHARED MODELS =================
# Load models lazily and safely. If imports or model files are missing,
# we set detector/embedder to None and continue running the API so the
# frontend can still fetch status and frames (without recognition overlays).
detector = None
embedder = None
if YOLO is not None:
    try:
        detector = YOLO(YOLO_MODEL_PATH)
    except Exception as e:
        print("Warning: YOLO model failed to initialize:", e)
        detector = None
else:
    print("ultralytics.YOLO not available; skipping detector initialization")

if FaceNet is not None:
    try:
        embedder = FaceNet()
    except Exception as e:
        print("Warning: FaceNet failed to initialize:", e)
        embedder = None
else:
    print("keras_facenet.FaceNet not available; skipping embedder initialization")

# ================= SCHEMAS =================
class LectureCreate(BaseModel):
    subject: str
    academic_year: Optional[str] = None
    standard_id: int
    division_id: int
    classroom: str  # Must match a key in CAMERAS
    start_time: str  # HH:MM
    end_time: str    # HH:MM
    lecture_date: Optional[str] = None  # YYYY-MM-DD

# ================= DB HELPERS =================
def load_embeddings_from_sqlite(standard_id, division_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT s.student_id, s.name, s.embedding
        FROM students s
        JOIN enrollments e ON s.student_id = e.student_id
        WHERE e.standard_id=? AND e.division_id=?
    """, (standard_id, division_id))

    rows = cursor.fetchall()
    conn.close()

    db = {}
    for student_id, name, emb_blob in rows:
        db[name] = {
            "student_id": student_id,
            "embedding": np.frombuffer(emb_blob, dtype=np.float32)
        }

    print(f"Loaded {len(db)} embeddings for standard {standard_id}, division {division_id}")
    return db

def get_active_lecture_from_db(camera_id, now):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Use localtime for India (IST) - SQLite handles it correctly
    cursor.execute("""
     SELECT lecture_id, subject, standard_id, division_id,
         start_time, end_time
     FROM lectures
     WHERE lecture_date = DATE('now', 'localtime')
     AND classroom = ?
     AND (cancelled IS NULL OR cancelled = 0)
     AND TIME('now', 'localtime') BETWEEN start_time AND end_time
     LIMIT 1
    """, (camera_id,))

    row = cursor.fetchone()
    conn.close()

    if not row:
        return None, None, None, None

    lecture_id, subject, standard_id, division_id, start, end = row

    start_dt = datetime.combine(now.date(), datetime.strptime(start, "%H:%M").time())
    attendance_end = start_dt + timedelta(minutes=ATTENDANCE_WINDOW_MIN)

    return {
        "lecture_id": lecture_id,
        "subject": subject,
        "standard_id": standard_id,
        "division_id": division_id
    }, attendance_end, subject, start_dt

# ================= UTILS =================
def cosine_match(emb, database):
    if not database:
        return "Unknown"
    min_dist = 1.0
    identity = "Unknown"
    for name, data in database.items():
        dist = cosine(emb, data["embedding"])
        if dist < min_dist:
            min_dist = dist
            identity = name
    return identity if min_dist < THRESHOLD else "Unknown"

def iou(boxA, boxB):
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    inter = max(0, xB - xA) * max(0, yB - yA)
    areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    return inter / (areaA + areaB - inter + 1e-6)

def detect_emotion_deepface(face_crop):
    """
    Detect emotion from a face crop using DeepFace.
    Returns: (emotion, confidence) or (None, None) if detection fails.
    """
    if DeepFace is None:
        return None, None
    
    try:
        # DeepFace.analyze expects BGR image and returns list of results
        result = DeepFace.analyze(face_crop, actions=['emotion'], enforce_detection=False)
        
        if result and len(result) > 0:
            emotion_dict = result[0].get('emotion', {})
            dominant_emotion = result[0].get('dominant_emotion', 'unknown')
            
            # Get confidence (normalized to 0-100)
            confidence = emotion_dict.get(dominant_emotion, 0) if emotion_dict else 0
            
            return dominant_emotion, confidence
    except Exception as e:
        # Silently fail on emotion detection errors
        pass
    
    return None, None

def save_emotion_to_db(lecture_id, camera_id, student_name, student_id, emotion, confidence, is_known_student):
    """
    Save individual emotion detection to database.
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        local_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("""
            INSERT INTO student_emotions
            (lecture_id, camera_id, student_id, student_name, emotion, confidence, is_known_student, detected_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (lecture_id, camera_id, student_id, student_name, emotion, confidence, is_known_student, local_time))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error saving emotion: {e}")

def aggregate_and_save_emotion_summary(lecture_id, camera_id, emotion_data_list):
    """
    Aggregate emotion data and save summary to database.
    """
    if not emotion_data_list or len(emotion_data_list) == 0:
        return
    
    try:
        # Count emotions
        emotion_counts = Counter([e['emotion'] for e in emotion_data_list if e['emotion']])
        total_detected = len(emotion_data_list)
        
        if total_detected > 0:
            # Calculate distribution
            emotion_dist = {
                emotion: round((count / total_detected) * 100, 2)
                for emotion, count in emotion_counts.items()
            }
            
            # Get dominant emotion
            dominant = emotion_counts.most_common(1)[0][0] if emotion_counts else 'unknown'
            
            # Calculate average confidence
            avg_conf = round(
                sum(e['confidence'] for e in emotion_data_list if e['confidence']) / total_detected,
                4
            )
            
            # Save to DB
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            sampling_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            cursor.execute("""
                INSERT OR REPLACE INTO student_emotion_summaries
                (lecture_id, camera_id, sampling_time, total_students_detected, emotion_distribution, dominant_emotion, avg_confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                lecture_id,
                camera_id,
                sampling_time,
                total_detected,
                json.dumps(emotion_dist),
                dominant,
                avg_conf
            ))
            conn.commit()
            conn.close()
    except Exception as e:
        print(f"Error saving emotion summary: {e}")


def emotion_worker_loop():
    """
    Run DeepFace emotion inference outside the frame processing loop.
    This keeps attendance and overlays responsive.
    """
    while True:
        try:
            job = emotion_job_queue.get(timeout=1)
        except Empty:
            continue

        try:
            cam_id = job["camera_id"]
            lecture_id = job["lecture_id"]
            state = camera_states.get(cam_id)
            if state is None:
                continue

            # Ignore stale jobs from previous lecture windows.
            if state.current_lecture_id != lecture_id:
                continue

            emotion, confidence = detect_emotion_deepface(job["face"])
            if not emotion:
                continue

            save_emotion_to_db(
                lecture_id=lecture_id,
                camera_id=cam_id,
                student_name=job["student_name"],
                student_id=job["student_id"],
                emotion=emotion,
                confidence=confidence,
                is_known_student=job["is_known_student"],
            )

            now_ts = time.time()
            batch_to_flush = None
            with state.emotion_lock:
                state.latest_track_emotions[job["track_id"]] = {
                    "emotion": emotion,
                    "confidence": confidence,
                    "ts": now_ts,
                }
                state.emotion_data_for_summary.append(
                    {
                        "emotion": emotion,
                        "confidence": confidence,
                        "name": job["student_name"],
                        "timestamp": now_ts,
                    }
                )

                size_ready = len(state.emotion_data_for_summary) >= EMOTION_SUMMARY_BATCH_SIZE
                time_ready = (now_ts - state.last_emotion_summary_flush) >= EMOTION_SUMMARY_FLUSH_SEC
                if size_ready or time_ready:
                    batch_to_flush = state.emotion_data_for_summary[:]
                    state.emotion_data_for_summary.clear()
                    state.last_emotion_summary_flush = now_ts

            if batch_to_flush:
                aggregate_and_save_emotion_summary(lecture_id, cam_id, batch_to_flush)

        except Exception as e:
            print(f"Emotion worker error: {e}")
        finally:
            emotion_job_queue.task_done()

# ================= THREADS =================
def camera_capture_loop(cam_id: str, state: CameraState):
    while True:
        if state.cap is None or not state.cap.isOpened():
            state.cap = cv2.VideoCapture(state.source)
            if isinstance(state.source, int):
                state.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        ret, frame = state.cap.read()
        if ret:
            with state.frame_lock:
                state.latest_frame = frame.copy()
        else:
            time.sleep(1)
            if state.cap:
                state.cap.release()
            state.cap = None
        time.sleep(0.03)

def attendance_processing_loop(cam_id: str, state: CameraState):
    while True:
        with state.frame_lock:
            if state.latest_frame is None:
                time.sleep(0.03)
                continue
            frame = state.latest_frame.copy()

        now = datetime.now()

        lecture, attendance_end, lecture_name, attendance_start = get_active_lecture_from_db(cam_id, now)

        # Reset state when lecture changes
        if lecture_name != state.current_lecture:
            state.current_lecture = lecture_name
            state.current_attendance_end = attendance_end
            state.current_attendance_start = attendance_start
            state.current_lecture_id = lecture["lecture_id"] if lecture else None

            if lecture:
                state.database = load_embeddings_from_sqlite(lecture["standard_id"], lecture["division_id"])
            else:
                state.database = {}

            state.tracks.clear()
            state.track_votes.clear()
            state.marked_students.clear()
            state.track_id_counter = 0
            state.last_emotion_capture.clear()
            with state.emotion_lock:
                state.emotion_data_for_summary.clear()
                state.latest_track_emotions.clear()
                state.last_emotion_summary_flush = time.time()

        # Auto attendance active?
        attendance_auto_active = False
        if lecture and attendance_start and attendance_end:
            attendance_auto_active = (attendance_start <= now <= attendance_end)
            # Disable auto if manual stop was used earlier in this window
            if (state.auto_disable_lecture_id == state.current_lecture_id and
                state.auto_disable_until and now <= state.auto_disable_until):
                attendance_auto_active = False

        attendance_active = state.manual_attendance or attendance_auto_active

        # Face detection + recognition only when models are available.
        if detector is None or embedder is None:
            # If models aren't available, skip recognition but keep latest_frame
            # so frontend can still show raw/annotated frames (without boxes).
            with state.frame_lock:
                state.annotated_frame = frame.copy()
            time.sleep(0.03)
            continue

        # Face detection
        try:
            results = detector(frame, conf=0.5, verbose=False)
            detections = [tuple(map(int, b)) for b in results[0].boxes.xyxy]
        except Exception as e:
            # If detector fails for a frame, skip this cycle
            print("Detector error:", e)
            with state.frame_lock:
                state.annotated_frame = frame.copy()
            time.sleep(0.03)
            continue

        # Simple tracking with IOU
        updated_tracks = {}
        for det in detections:
            matched = False
            for tid, prev in state.tracks.items():
                if iou(det, prev) > IOU_THRESHOLD:
                    updated_tracks[tid] = det
                    matched = True
                    break
            if not matched:
                state.track_id_counter += 1
                updated_tracks[state.track_id_counter] = det

        # Remove stale emotion cache for tracks that no longer exist.
        stale_track_ids = set(state.last_emotion_capture.keys()) - set(updated_tracks.keys())
        for stale_tid in stale_track_ids:
            state.last_emotion_capture.pop(stale_tid, None)
        with state.emotion_lock:
            for stale_tid in stale_track_ids:
                state.latest_track_emotions.pop(stale_tid, None)

        state.tracks = updated_tracks

        # Recognition and voting
        for tid, (x1, y1, x2, y2) in state.tracks.items():
            face = frame[y1:y2, x1:x2]
            if face.size == 0:
                continue
            
            # Keep original face crop for emotion detection
            face_original = face.copy()
            
            try:
                face_resized = cv2.resize(face, (160, 160))
                emb = embedder.embeddings(np.expand_dims(face_resized, axis=0))[0]
            except Exception as e:
                print("Embedder error:", e)
                continue

            name = cosine_match(emb, state.database)
            state.track_votes[tid].append(name)
            if len(state.track_votes[tid]) > VOTE_FRAMES:
                state.track_votes[tid].pop(0)

            best_name, count = Counter(state.track_votes[tid]).most_common(1)[0]

            # Mark attendance if conditions met
            if attendance_active and best_name != "Unknown" and count >= VOTE_FRAMES // 2 + 1:
                if best_name not in state.marked_students:
                    state.marked_students.add(best_name)
                    student_id = state.database[best_name]["student_id"]
                    local_time = now.strftime("%Y-%m-%d %H:%M:%S")

                    conn = sqlite3.connect(DB_PATH)
                    cursor = conn.cursor()
                    cursor.execute("""
                        INSERT OR IGNORE INTO attendance
                        (lecture_id, student_id, marked_at, camera_id)
                        VALUES (?, ?, ?, ?)
                    """, (state.current_lecture_id, student_id, local_time, cam_id))
                    conn.commit()
                    conn.close()
                    print(f"Marked attendance: {best_name} for lecture {state.current_lecture_id} on {cam_id}")

            # Draw bounding box and label
            color = (0, 255, 0) if best_name != "Unknown" else (0, 0, 255)
            label = f"{best_name} [{count}/{VOTE_FRAMES}]"
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

            # Render latest emotion if a recent worker result exists for this track.
            emotion_line = None
            with state.emotion_lock:
                emotion_info = state.latest_track_emotions.get(tid)
            if emotion_info and (time.time() - emotion_info["ts"]) <= EMOTION_OVERLAY_TTL_SEC:
                emotion_line = f"{emotion_info['emotion']} ({emotion_info['confidence']:.0f}%)"

            if emotion_line:
                text_y = y1 - 34 if y1 > 40 else y1 + 20
                cv2.putText(
                    frame,
                    emotion_line,
                    (x1, text_y),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 255, 255),
                    2,
                )

            # Emotion detection queue (only during active lecture, throttled)
            if (
                EMOTION_DETECTION_ENABLED
                and DeepFace is not None
                and attendance_active
                and state.current_lecture_id
                and (x2 - x1) >= EMOTION_MIN_FACE_SIZE
                and (y2 - y1) >= EMOTION_MIN_FACE_SIZE
            ):
                current_time = time.time()
                last_capture_time = state.last_emotion_capture.get(tid, 0.0)
                if current_time - last_capture_time >= EMOTION_CAPTURE_INTERVAL_SEC:
                    is_known = 1 if best_name != "Unknown" else 0
                    student_id_emotion = state.database[best_name]["student_id"] if best_name != "Unknown" else None
                    try:
                        # Smaller crop reduces DeepFace inference cost significantly.
                        emotion_face = cv2.resize(face_original, (112, 112))
                        emotion_job_queue.put_nowait(
                            {
                                "camera_id": cam_id,
                                "lecture_id": state.current_lecture_id,
                                "track_id": tid,
                                "face": emotion_face,
                                "student_name": best_name,
                                "student_id": student_id_emotion,
                                "is_known_student": is_known,
                            }
                        )
                        state.last_emotion_capture[tid] = current_time
                    except Full:
                        # Skip emotion for this cycle when queue is saturated.
                        pass
                    except Exception:
                        pass

        # Keep bounding boxes and per-track labels/counts (drawn above),
        # but do not render the additional on-frame information text
        # because the frontend shows these details in the separate
        # Information Panel.
        with state.frame_lock:
            state.annotated_frame = frame.copy()

        time.sleep(0.03)

def generate_frames_for_camera(cam_id: str):
    state = camera_states[cam_id]
    while True:
        with state.frame_lock:
            if state.annotated_frame is None:
                time.sleep(0.03)
                continue
            _, buffer = cv2.imencode(".jpg", state.annotated_frame)
            yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n")

# Start capture and processing threads for all cameras
for _ in range(EMOTION_WORKER_COUNT):
    threading.Thread(target=emotion_worker_loop, daemon=True).start()

for cam_id in CAMERAS:
    threading.Thread(target=camera_capture_loop, args=(cam_id, camera_states[cam_id]), daemon=True).start()
    threading.Thread(target=attendance_processing_loop, args=(cam_id, camera_states[cam_id]), daemon=True).start()

# ================= API ROUTES =================
@app.get("/")
def root():
    return {"status": "Multi-Camera Face Attendance Backend Running", "cameras": list(CAMERAS.keys())}


@app.get("/lectures/all")
def list_all_lectures():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # Determine if 'cancelled' column exists
    cursor.execute("PRAGMA table_info(lectures)")
    cols = [info[1] for info in cursor.fetchall()]
    select_fields = "l.lecture_id, l.subject, l.lecture_date, l.start_time, l.end_time, l.academic_year, s.name AS standard, d.name AS division, l.classroom"
    if 'cancelled' in cols:
        select_fields += ", l.cancelled"

    # Join standards/divisions to return readable names for the frontend
    cursor.execute(f"SELECT {select_fields} FROM lectures l LEFT JOIN standards s ON s.standard_id = l.standard_id LEFT JOIN divisions d ON d.division_id = l.division_id ORDER BY l.lecture_date DESC, l.start_time DESC")
    rows = cursor.fetchall()
    conn.close()

    lectures = []
    for row in rows:
        # row may contain cancelled as last column if present
        if 'cancelled' in cols:
            lecture_id, subject, lecture_date, start_time, end_time, academic_year, standard, division, classroom, cancelled = row
            is_cancelled = bool(cancelled)
        else:
            lecture_id, subject, lecture_date, start_time, end_time, academic_year, standard, division, classroom = row
            is_cancelled = False

        lectures.append({
            "id": lecture_id,
            "subject": subject,
            "date": lecture_date,
            "startTime": start_time,
            "endTime": end_time,
            "academicYear": academic_year,
            "standard": standard,
            "division": division,
            "classRoom": classroom,
            "cancelled": is_cancelled,
        })
    return lectures


@app.get("/dashboard/kpis")
def dashboard_kpis():
    # Cameras
    total_cameras = len(CAMERAS)
    active_cameras = 0
    offline = []
    for cam_id, state in camera_states.items():
        cap = state.cap
        try:
            opened = cap is not None and getattr(cap, 'isOpened', lambda: False)()
        except Exception:
            opened = False
        if opened:
            active_cameras += 1
        else:
            offline.append(cam_id)

    # Active lectures (simple heuristic: count cameras with a current lecture)
    active_lectures = sum(1 for s in camera_states.values() if s.current_lecture)

    # Total students
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) FROM students")
        total_students = cursor.fetchone()[0] or 0

        # Today's attendance summary
        cursor.execute("SELECT COUNT(DISTINCT student_id) FROM attendance WHERE date(marked_at) = date('now','localtime')")
        present_today = cursor.fetchone()[0] or 0
    except Exception:
        total_students = 0
        present_today = 0
    conn.close()

    absent_today = max(0, total_students - present_today)
    percentage = round((present_today / total_students) * 100, 2) if total_students > 0 else 0.0

    # Per-classroom status (busy/free) based on current lecture state and camera online status
    classrooms = []
    # Reuse DB connection to fetch lecture times for busy classrooms
    conn2 = sqlite3.connect(DB_PATH)
    cursor2 = conn2.cursor()
    for cam_id, state in camera_states.items():
        try:
            is_online = state.cap is not None and getattr(state.cap, 'isOpened', lambda: False)()
        except Exception:
            is_online = False
        busy = bool(state.current_lecture)
        start_time = None
        end_time = None
        lecture_date = None
        if busy and state.current_lecture_id:
            try:
                cursor2.execute("SELECT start_time, end_time, lecture_date FROM lectures WHERE lecture_id = ?", (state.current_lecture_id,))
                row = cursor2.fetchone()
                if row:
                    start_time, end_time, lecture_date = row
            except Exception:
                start_time = None
                end_time = None

        classrooms.append({
            "camera_id": cam_id,
            "is_online": bool(is_online),
            "status": "busy" if busy else "free",
            "current_lecture": state.current_lecture if busy else None,
            "start_time": start_time,
            "end_time": end_time,
            "lecture_date": lecture_date,
        })
    conn2.close()

    return {
        "total_cameras": total_cameras,
        "active_cameras": active_cameras,
        "active_lectures": active_lectures,
        "total_students": total_students,
        "today_attendance": {
            "present_count": present_today,
            "absent_count": absent_today,
            "percentage": percentage,
        },
        "offline_cameras": offline,
        "classrooms": classrooms,
    }



@app.get("/students/all")
def list_all_students():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # For each student, compute total lectures they should attend and how many they attended
    cursor.execute("""
        SELECT
            s.student_id,
            s.name,
            st.name AS standard,
            d.name AS division,
            COUNT(DISTINCT l.lecture_id) AS total_lectures,
            COUNT(DISTINCT a.lecture_id) AS present_lectures
        FROM students s
        LEFT JOIN enrollments e ON e.student_id = s.student_id
        LEFT JOIN standards st ON st.standard_id = e.standard_id
        LEFT JOIN divisions d ON d.division_id = e.division_id
        LEFT JOIN lectures l ON l.standard_id = e.standard_id AND l.division_id = e.division_id AND (l.cancelled IS NULL OR l.cancelled = 0)
        LEFT JOIN attendance a ON a.student_id = s.student_id AND a.lecture_id = l.lecture_id
        GROUP BY s.student_id, s.name, st.name, d.name
    """)
    rows = cursor.fetchall()
    conn.close()

    students = []
    for student_id, name, standard, division, total_lectures, present_lectures in rows:
        total = total_lectures or 0
        present = present_lectures or 0
        absent = max(0, total - present)
        attendance_pct = round((present / total) * 100, 2) if total > 0 else 0.0
        students.append({
            "id": student_id,
            "name": name,
            "standard": standard or '',
            "division": division or '',
            "avatarUrl": None,
            "overallAttendance": attendance_pct,
            "presentCount": present,
            "absentCount": absent,
        })
    return students


@app.get("/attendance/lecture/{lecture_id}")
def attendance_for_lecture(lecture_id: int = Path(...)):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # Get lecture info to find standard/division and cancelled flag
    cursor.execute("SELECT lecture_id, subject, standard_id, division_id, lecture_date, cancelled FROM lectures WHERE lecture_id = ?", (lecture_id,))
    lecture_row = cursor.fetchone()
    if not lecture_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Lecture not found")

    # Unpack lecture_row; cancelled may be present (0/1 or NULL)
    _, _, standard_id, division_id, _, cancelled_flag = lecture_row
    is_cancelled = bool(cancelled_flag)

    # Get enrolled students for this lecture's standard/division
    cursor.execute("""
        SELECT s.student_id, s.name
        FROM students s
        JOIN enrollments e ON e.student_id = s.student_id
        WHERE e.standard_id = ? AND e.division_id = ?
    """, (standard_id, division_id))
    students = cursor.fetchall()

    # If lecture is cancelled, return students with 'Cancelled' status (do not show Absent)
    if is_cancelled:
        result = []
        for student_id, name in students:
            result.append({
                "studentId": student_id,
                "studentName": name,
                "status": "Cancelled",
                "markedTime": None,
                "cameraId": None,
            })
        conn.close()
        return {"attendance": result, "cancelled": True}

    # Get attendance marks for this lecture
    cursor.execute("SELECT student_id, marked_at, camera_id FROM attendance WHERE lecture_id = ?", (lecture_id,))
    attendance_rows = {row[0]: (row[1], row[2]) for row in cursor.fetchall()}

    result = []
    for student_id, name in students:
        marked = attendance_rows.get(student_id)
        present = marked is not None
        marked_time = marked[0] if present else None
        camera_id = marked[1] if present else None
        result.append({
            "studentId": student_id,
            "studentName": name,
            "status": "Present" if present else "Absent",
            "markedTime": marked_time,
            "cameraId": camera_id,
        })

    conn.close()
    return {"attendance": result}

@app.get("/cameras")
def list_cameras():
    return {"cameras": list(CAMERAS.keys())}

@app.get("/video/{camera_id}")
def video_feed(camera_id: str = Path(..., description="Camera ID e.g. C101")):
    if camera_id not in CAMERAS:
        raise HTTPException(status_code=404, detail="Camera not configured")
    return StreamingResponse(generate_frames_for_camera(camera_id),
                             media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/lectures")
def create_lecture(payload: dict):
    # Accept flexible payloads from the frontend and map common field names
    # to the DB column names expected in the lectures table.
    mapping = {
        "academicYear": "academic_year",
        "classRoom": "classroom",
        "date": "lecture_date",
        "startTime": "start_time",
        "endTime": "end_time",
        "standard": "standard_id",
        "division": "division_id",
    }

    # Normalize incoming keys
    data = {}
    for k, v in payload.items():
        if k in mapping:
            data[mapping[k]] = v
        else:
            data[k] = v

    # If lecture_date missing, set today's date if column exists
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(lectures)")
    cols = [info[1] for info in cursor.fetchall()]

    if "lecture_date" not in data and "lecture_date" in cols:
        data["lecture_date"] = datetime.now().strftime("%Y-%m-%d")

    # Validate classroom if present
    if "classroom" in data and data["classroom"] not in CAMERAS:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid classroom: must be one of configured cameras")

    # Ensure start_time and end_time exist for overlap checks
    if "start_time" not in data or "end_time" not in data:
        conn.close()
        raise HTTPException(status_code=400, detail="start_time and end_time are required")

    # Normalize times to HH:MM (basic validation)
    try:
        _ = datetime.strptime(data["start_time"], "%H:%M").time()
        _ = datetime.strptime(data["end_time"], "%H:%M").time()
    except Exception:
        conn.close()
        raise HTTPException(status_code=400, detail="start_time and end_time must be in HH:MM format")

    # Check for classroom conflicts: same classroom, same date, overlapping time
    if "lecture_date" in data and "classroom" in data:
        cursor.execute("""
            SELECT lecture_id FROM lectures
            WHERE lecture_date = ?
            AND classroom = ?
            AND NOT (TIME(end_time) <= TIME(?) OR TIME(start_time) >= TIME(?))
            LIMIT 1
        """, (data["lecture_date"], data["classroom"], data["start_time"], data["end_time"]))
        row = cursor.fetchone()
        if row:
            conn.close()
            raise HTTPException(status_code=400, detail="Conflict: another lecture is scheduled in the same classroom at this date/time")

    # Check for standard/division conflicts: same standard+division, same date, overlapping time
    if "lecture_date" in data and "standard_id" in data and "division_id" in data:
        cursor.execute("""
            SELECT lecture_id FROM lectures
            WHERE lecture_date = ?
            AND standard_id = ? AND division_id = ?
            AND NOT (TIME(end_time) <= TIME(?) OR TIME(start_time) >= TIME(?))
            LIMIT 1
        """, (data["lecture_date"], data["standard_id"], data["division_id"], data["start_time"], data["end_time"]))
        row = cursor.fetchone()
        if row:
            conn.close()
            raise HTTPException(status_code=400, detail="Conflict: the same standard/division has another lecture at this date/time")

    # Normalize standard/division: if frontend sent names (e.g. 'FY','SY','TY' or 'A','B','C'),
    # map them to numeric IDs via the standards/divisions tables (create entries if missing).
    def ensure_standard_id(val):
        # if already numeric, return as int
        try:
            return int(val)
        except Exception:
            name = str(val).strip()
            cursor.execute("SELECT standard_id FROM standards WHERE name = ?", (name,))
            row = cursor.fetchone()
            if row:
                return row[0]
            # insert and return new id
            cursor.execute("INSERT INTO standards (name) VALUES (?)", (name,))
            conn.commit()
            return cursor.lastrowid

    def ensure_division_id(val):
        try:
            return int(val)
        except Exception:
            name = str(val).strip()
            cursor.execute("SELECT division_id FROM divisions WHERE name = ?", (name,))
            row = cursor.fetchone()
            if row:
                return row[0]
            cursor.execute("INSERT INTO divisions (name) VALUES (?)", (name,))
            conn.commit()
            return cursor.lastrowid

    # If frontend provided human-readable fields, convert them
    if "standard_id" in data and data["standard_id"] is not None:
        data["standard_id"] = ensure_standard_id(data["standard_id"])
    elif "standard" in data and data["standard"] is not None:
        data["standard_id"] = ensure_standard_id(data.pop("standard"))

    if "division_id" in data and data["division_id"] is not None:
        data["division_id"] = ensure_division_id(data["division_id"])
    elif "division" in data and data["division"] is not None:
        data["division_id"] = ensure_division_id(data.pop("division"))

    insert_keys = [k for k in data if k in cols]
    if not insert_keys:
        conn.close()
        raise HTTPException(status_code=400, detail="No valid columns to insert")

    placeholders = ", ".join(["?"] * len(insert_keys))
    keys_sql = ", ".join(insert_keys)
    values = [data[k] for k in insert_keys]

    try:
        cursor.execute(f"INSERT INTO lectures ({keys_sql}) VALUES ({placeholders})", values)
        conn.commit()
        lecture_id = cursor.lastrowid
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"DB insert error: {e}")

    conn.close()
    return {"lecture_id": lecture_id, "message": "Lecture created successfully"}


@app.put("/lectures/{lecture_id}")
def update_lecture(lecture_id: int, payload: dict):
    # Accept flexible payloads and map keys like create_lecture
    mapping = {
        "academicYear": "academic_year",
        "classRoom": "classroom",
        "date": "lecture_date",
        "startTime": "start_time",
        "endTime": "end_time",
        "standard": "standard_id",
        "division": "division_id",
    }

    # Normalize incoming keys
    data = {}
    for k, v in payload.items():
        if k in mapping:
            data[mapping[k]] = v
        else:
            data[k] = v

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Ensure lecture exists
    cursor.execute("SELECT lecture_id FROM lectures WHERE lecture_id = ?", (lecture_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Lecture not found")

    # Get lecture table columns
    cursor.execute("PRAGMA table_info(lectures)")
    cols = [info[1] for info in cursor.fetchall()]

    # Helpers to resolve standard/division names to ids (duplicate of create_lecture helpers)
    def ensure_standard_id(val):
        try:
            return int(val)
        except Exception:
            name = str(val).strip()
            cursor.execute("SELECT standard_id FROM standards WHERE name = ?", (name,))
            row = cursor.fetchone()
            if row:
                return row[0]
            cursor.execute("INSERT INTO standards (name) VALUES (?)", (name,))
            conn.commit()
            return cursor.lastrowid

    def ensure_division_id(val):
        try:
            return int(val)
        except Exception:
            name = str(val).strip()
            cursor.execute("SELECT division_id FROM divisions WHERE name = ?", (name,))
            row = cursor.fetchone()
            if row:
                return row[0]
            cursor.execute("INSERT INTO divisions (name) VALUES (?)", (name,))
            conn.commit()
            return cursor.lastrowid

    # Convert standard/division if provided
    if "standard_id" in data and data["standard_id"] is not None:
        data["standard_id"] = ensure_standard_id(data["standard_id"])
    elif "standard" in data and data["standard"] is not None:
        data["standard_id"] = ensure_standard_id(data.pop("standard"))

    if "division_id" in data and data["division_id"] is not None:
        data["division_id"] = ensure_division_id(data["division_id"])
    elif "division" in data and data["division"] is not None:
        data["division_id"] = ensure_division_id(data.pop("division"))

    # Validate classroom if present
    if "classroom" in data and data["classroom"] not in CAMERAS:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid classroom: must be one of configured cameras")

    # Validate times if provided
    try:
        if "start_time" in data:
            _ = datetime.strptime(data["start_time"], "%H:%M").time()
        if "end_time" in data:
            _ = datetime.strptime(data["end_time"], "%H:%M").time()
    except Exception:
        conn.close()
        raise HTTPException(status_code=400, detail="start_time and end_time must be in HH:MM format")

    # Conflict checks: if date/classroom/start_time/end_time provided, ensure no overlap with other lectures
    if any(k in data for k in ("lecture_date", "classroom", "start_time", "end_time")):
        lecture_date = data.get("lecture_date")
        classroom = data.get("classroom")
        start_time = data.get("start_time")
        end_time = data.get("end_time")
        # To check conflicts we need values; if some are missing, fetch current values
        cursor.execute("SELECT lecture_date, classroom, start_time, end_time FROM lectures WHERE lecture_id = ?", (lecture_id,))
        cur_row = cursor.fetchone()
        if cur_row:
            cur_date, cur_classroom, cur_start, cur_end = cur_row
            lecture_date = lecture_date or cur_date
            classroom = classroom or cur_classroom
            start_time = start_time or cur_start
            end_time = end_time or cur_end

            cursor.execute("""
                SELECT lecture_id FROM lectures
                WHERE lecture_date = ?
                AND classroom = ?
                AND NOT (TIME(end_time) <= TIME(?) OR TIME(start_time) >= TIME(?))
                AND lecture_id != ?
                LIMIT 1
            """, (lecture_date, classroom, start_time, end_time, lecture_id))
            row = cursor.fetchone()
            if row:
                conn.close()
                raise HTTPException(status_code=400, detail="Conflict: another lecture is scheduled in the same classroom at this date/time")

    # Build update statement for provided columns that exist in table
    update_keys = [k for k in data if k in cols]
    if not update_keys:
        conn.close()
        raise HTTPException(status_code=400, detail="No valid columns to update")

    set_clause = ", ".join([f"{k} = ?" for k in update_keys])
    values = [data[k] for k in update_keys] + [lecture_id]

    try:
        cursor.execute(f"UPDATE lectures SET {set_clause} WHERE lecture_id = ?", values)
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"DB update error: {e}")

    conn.close()
    return {"lecture_id": lecture_id, "message": "Lecture updated successfully"}


@app.delete("/lectures/{lecture_id}")
def delete_lecture(lecture_id: int):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT lecture_id, classroom, lecture_date, end_time FROM lectures WHERE lecture_id = ?", (lecture_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Lecture not found")

    # If cancelled column doesn't exist, add it
    cursor.execute("PRAGMA table_info(lectures)")
    cols = [info[1] for info in cursor.fetchall()]
    if 'cancelled' not in cols:
        try:
            cursor.execute("ALTER TABLE lectures ADD COLUMN cancelled INTEGER DEFAULT 0")
            conn.commit()
        except Exception:
            # If ALTER fails, continue; we'll try to update later and may error
            pass

    classroom = row[1]
    lecture_date = row[2]
    end_time = row[3]
    # If lecture_date missing, assume today's date
    try:
        lecture_date_val = datetime.strptime(lecture_date, "%Y-%m-%d").date() if lecture_date else datetime.now().date()
    except Exception:
        lecture_date_val = datetime.now().date()

    try:
        end_time_val = datetime.strptime(end_time, "%H:%M").time() if end_time else None
    except Exception:
        end_time_val = None

    if end_time_val:
        lecture_end = datetime.combine(lecture_date_val, end_time_val)
    else:
        lecture_end = datetime.combine(lecture_date_val, datetime.max.time())

    now = datetime.now()
    if now > lecture_end:
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot cancel lecture after its end time")

    # Mark as cancelled
    try:
        cursor.execute("UPDATE lectures SET cancelled = 1 WHERE lecture_id = ?", (lecture_id,))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"DB update error: {e}")

    # Stop attendance for the classroom immediately by clearing camera state
    try:
        if classroom in camera_states:
            state = camera_states[classroom]
            state.manual_attendance = False
            state.current_lecture = None
            state.current_lecture_id = None
            state.current_attendance_start = None
            state.current_attendance_end = None
            state.tracks.clear()
            state.track_votes.clear()
            state.marked_students.clear()
            state.track_id_counter = 0
            state.auto_disable_lecture_id = lecture_id
            state.auto_disable_until = datetime.max
    except Exception:
        # non-fatal if camera state cannot be updated
        pass

    conn.close()
    return {"lecture_id": lecture_id, "message": "Lecture marked as cancelled"}

@app.post("/attendance/start/{camera_id}")
def start_attendance(camera_id: str = Path(...)):
    if camera_id not in CAMERAS:
        raise HTTPException(status_code=404, detail="Camera not found")
    state = camera_states[camera_id]
    if state.manual_attendance:
        raise HTTPException(status_code=400, detail="Manual attendance already active")
    state.manual_attendance = True
    return {"message": f"Manual attendance STARTED for camera {camera_id}"}

@app.post("/attendance/stop/{camera_id}")
def stop_attendance(camera_id: str = Path(...)):
    if camera_id not in CAMERAS:
        raise HTTPException(status_code=404, detail="Camera not found")
    state = camera_states[camera_id]
    if not state.manual_attendance:
        raise HTTPException(status_code=400, detail="Manual attendance not active")
    state.manual_attendance = False

    # Disable auto for remainder of current window
    now = datetime.now()
    if state.current_lecture_id and state.current_attendance_end and now <= state.current_attendance_end:
        state.auto_disable_lecture_id = state.current_lecture_id
        state.auto_disable_until = state.current_attendance_end

    return {"message": f"Manual attendance STOPPED for camera {camera_id}"}


@app.post("/attendance/disable_auto/{camera_id}")
def disable_auto_attendance(camera_id: str = Path(...)):
    if camera_id not in CAMERAS:
        raise HTTPException(status_code=404, detail="Camera not found")
    state = camera_states[camera_id]
    now = datetime.now()

    # Only disable if there's a current lecture window
    if not state.current_lecture_id or not state.current_attendance_end or not state.current_attendance_start:
        raise HTTPException(status_code=400, detail="No active automatic attendance window to disable")

    # If already disabled for this lecture, return idempotent response
    if state.auto_disable_lecture_id == state.current_lecture_id and state.auto_disable_until and now <= state.auto_disable_until:
        return {"message": "Automatic attendance already disabled for current window"}

    # Disable auto for remainder of current window
    if now <= state.current_attendance_end:
        state.auto_disable_lecture_id = state.current_lecture_id
        state.auto_disable_until = state.current_attendance_end
        return {"message": f"Automatic attendance disabled for camera {camera_id} until {state.current_attendance_end}"}

    raise HTTPException(status_code=400, detail="Attendance window already finished")


@app.post("/attendance/mark")
def mark_attendance(payload: dict):
    """Mark a student present for a lecture. Expects JSON with lecture_id, student_id and optional camera_id."""
    lecture_id = payload.get('lecture_id')
    student_id = payload.get('student_id')
    camera_id = payload.get('camera_id') if payload.get('camera_id') else None

    if not lecture_id or not student_id:
        raise HTTPException(status_code=400, detail="lecture_id and student_id are required")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        # Insert or ignore if already present
        cursor.execute("INSERT OR IGNORE INTO attendance (lecture_id, student_id, marked_at, camera_id) VALUES (?, ?, datetime('now', 'localtime'), ?)",
                       (lecture_id, student_id, camera_id))
        conn.commit()
        # If row didn't exist, cursor.rowcount may be 1; fetch the marked_at
        cursor.execute("SELECT marked_at, camera_id FROM attendance WHERE lecture_id=? AND student_id=?", (lecture_id, student_id))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {"message": "Marked present", "marked_at": row[0], "camera_id": row[1]}
        return {"message": "Already marked"}
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


@app.post("/attendance/unmark")
def unmark_attendance(payload: dict):
    """Remove an attendance mark. Expects JSON with lecture_id and student_id."""
    lecture_id = payload.get('lecture_id')
    student_id = payload.get('student_id')

    if not lecture_id or not student_id:
        raise HTTPException(status_code=400, detail="lecture_id and student_id are required")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM attendance WHERE lecture_id=? AND student_id=?", (lecture_id, student_id))
        conn.commit()
        deleted = cursor.rowcount
        conn.close()
        if deleted:
            return {"message": "Attendance removed"}
        return {"message": "No attendance record found"}
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"DB error: {e}")

@app.get("/status/{camera_id}")
def get_status(camera_id: str = Path(...)):
    if camera_id not in CAMERAS:
        raise HTTPException(status_code=404, detail="Camera not found")
    state = camera_states[camera_id]
    now = datetime.now()

    attendance_auto_active = False
    if state.current_attendance_start and state.current_attendance_end:
        attendance_auto_active = (state.current_attendance_start <= now <= state.current_attendance_end)
        if (state.auto_disable_lecture_id == state.current_lecture_id and
            state.auto_disable_until and now <= state.auto_disable_until):
            attendance_auto_active = False

    # Determine if camera capture is online
    try:
        is_online = state.cap is not None and getattr(state.cap, 'isOpened', lambda: False)()
    except Exception:
        is_online = False

    return {
        "camera_id": camera_id,
        "current_lecture": state.current_lecture or "None",
        "current_lecture_id": state.current_lecture_id,
        "manual_attendance": state.manual_attendance,
        "auto_attendance_active": attendance_auto_active,
        "attendance_window_start": state.current_attendance_start.strftime("%H:%M") if state.current_attendance_start else None,
        "attendance_window_end": state.current_attendance_end.strftime("%H:%M") if state.current_attendance_end else None,
        "marked_students_count": len(state.marked_students),
        "is_online": bool(is_online),
    }

@app.get("/attendance/csv/{lecture_id}")
def download_attendance_csv(lecture_id: int):
    conn = sqlite3.connect(DB_PATH)
    query = """
    SELECT 
        s.name AS student_name,
        l.subject,
        COALESCE(a.camera_id, l.classroom) AS camera_id,
        l.lecture_date,
        a.marked_at
    FROM attendance a
    JOIN students s ON a.student_id = s.student_id
    JOIN lectures l ON a.lecture_id = l.lecture_id
    WHERE a.lecture_id = ?
    ORDER BY a.marked_at
    """
    df = pd.read_sql_query(query, conn, params=(lecture_id,))
    conn.close()

    if df.empty:
        raise HTTPException(status_code=404, detail="No attendance records found for this lecture")

    file_path = os.path.join(ATTENDANCE_DIR, f"attendance_lecture_{lecture_id}.csv")
    # Ensure directory exists
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    df.to_csv(file_path, index=False)

    # Return file as attachment so frontend can download directly
    if not os.path.exists(file_path):
        raise HTTPException(status_code=500, detail="Failed to generate CSV")

    return FileResponse(path=file_path, filename=os.path.basename(file_path), media_type='text/csv')

@app.get("/attendance/stats/{lecture_id}")
def get_attendance_stats(lecture_id: int):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Check if lecture exists and whether it's cancelled
    cursor.execute("SELECT cancelled FROM lectures WHERE lecture_id = ?", (lecture_id,))
    cancelled_row = cursor.fetchone()
    if not cancelled_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Lecture not found")
    is_cancelled = bool(cancelled_row[0]) if cancelled_row[0] is not None else False

    # Step 1: Get lecture details + enrolled student count
    cursor.execute("""
        SELECT 
            l.subject,
            l.classroom,
            l.lecture_date,
            COUNT(DISTINCT e.student_id) AS total_students
        FROM lectures l
        LEFT JOIN enrollments e ON e.standard_id = l.standard_id AND e.division_id = l.division_id
        WHERE l.lecture_id = ?
        GROUP BY l.lecture_id
    """, (lecture_id,))

    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Lecture not found")

    subject, classroom, lecture_date, total_students = row

    if total_students == 0:
        conn.close()
        return {
            "lecture_id": lecture_id,
            "subject": subject,
            "classroom": classroom,
            "lecture_date": lecture_date,
            "total_students": 0,
            "present_count": 0,
            "absent_count": 0,
            "attendance_percentage": 0.0,
            "cancelled": is_cancelled
        }

    # Step 2: Count present students (those marked in attendance table)
    cursor.execute("""
        SELECT COUNT(DISTINCT student_id) 
        FROM attendance 
        WHERE lecture_id = ?
    """, (lecture_id,))

    present_count = cursor.fetchone()[0] or 0

    conn.close()

    # If lecture was cancelled, ignore attendance marks and report cancelled
    if is_cancelled:
        return {
            "lecture_id": lecture_id,
            "subject": subject,
            "classroom": classroom,
            "lecture_date": lecture_date,
            "total_students": total_students,
            "present_count": 0,
            "absent_count": 0,
            "attendance_percentage": 0.0,
            "cancelled": True
        }

    # Step 3: Calculate stats for active lecture
    absent_count = total_students - present_count
    attendance_percentage = round((present_count / total_students) * 100, 2)

    return {
        "lecture_id": lecture_id,
        "subject": subject,
        "classroom": classroom,
        "lecture_date": lecture_date,
        "total_students": total_students,
        "present_count": present_count,
        "absent_count": absent_count,
        "attendance_percentage": attendance_percentage,
        "cancelled": False
    }
@app.get("/attendance/student/{student_id}/lecture/{lecture_id}")
def get_student_lecture_attendance(student_id: int, lecture_id: int):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get lecture details + attendance record for this student
    cursor.execute("""
        SELECT 
            l.subject,
            l.classroom,
            l.lecture_date,
            l.start_time,
            a.marked_at,
            a.camera_id
        FROM lectures l
        LEFT JOIN attendance a ON a.lecture_id = l.lecture_id AND a.student_id = ?
        WHERE l.lecture_id = ?
    """, (student_id, lecture_id))

    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Lecture or student not found")

    subject, classroom, lecture_date, start_time, marked_at, camera_id = row

    present = marked_at is not None
    marked_time = marked_at if present else None

    return {
        "student_id": student_id,
        "lecture_id": lecture_id,
        "subject": subject,
        "classroom": classroom,
        "lecture_date": lecture_date,
        "lecture_time": start_time,
        "present": present,
        "marked_at": marked_time,
        "marked_by_camera": camera_id if present else None,
        "status": "Present" if present else "Absent"
    }


@app.get("/attendance/student/{student_id}/summary")
def get_student_attendance_summary(student_id: int):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # First: Get student's name
    cursor.execute("SELECT name FROM students WHERE student_id = ?", (student_id,))
    student_row = cursor.fetchone()
    if not student_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Student not found")
    student_name = student_row[0]

    # Get student's enrolled standard/division names (if any)
    cursor.execute("""
        SELECT st.name, d.name
        FROM enrollments e
        LEFT JOIN standards st ON st.standard_id = e.standard_id
        LEFT JOIN divisions d ON d.division_id = e.division_id
        WHERE e.student_id = ?
        LIMIT 1
    """, (student_id,))
    enroll_row = cursor.fetchone()
    standard_name = enroll_row[0] if enroll_row and enroll_row[0] else ''
    division_name = enroll_row[1] if enroll_row and enroll_row[1] else ''

    # Get all lectures the student could attend (based on their enrollment)
    # Assuming one academic year or all — adjust if needed
    cursor.execute("""
        SELECT 
            l.lecture_id,
            l.subject,
            l.classroom,
            l.lecture_date,
            l.start_time,
            a.marked_at,
            a.camera_id
        FROM lectures l
        JOIN enrollments e ON e.standard_id = l.standard_id AND e.division_id = l.division_id AND (l.cancelled IS NULL OR l.cancelled = 0)
        LEFT JOIN attendance a ON a.lecture_id = l.lecture_id AND a.student_id = ?
        WHERE e.student_id = ?
        ORDER BY l.lecture_date DESC, l.start_time DESC
    """, (student_id, student_id))

    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return {
            "student_id": student_id,
            "student_name": student_name,
            "standard": standard_name,
            "division": division_name,
            "total_lectures": 0,
            "present_count": 0,
            "absent_count": 0,
            "attendance_percentage": 0.0,
            "lectures": []
        }

    total_lectures = len(rows)
    present_count = sum(1 for row in rows if row[5] is not None)  # marked_at not null
    absent_count = total_lectures - present_count
    attendance_percentage = round((present_count / total_lectures) * 100, 2) if total_lectures > 0 else 0.0

    lectures_list = []
    for row in rows:
        lecture_id, subject, classroom, lecture_date, start_time, marked_at, camera_id = row
        lectures_list.append({
            "lecture_id": lecture_id,
            "subject": subject,
            "classroom": classroom,
            "date": lecture_date,
            "time": start_time,
            "present": marked_at is not None,
            "marked_at": marked_at,
            "marked_by_camera": camera_id
        })

    return {
        "student_id": student_id,
        "student_name": student_name,
        "standard": standard_name,
        "division": division_name,
        "total_lectures": total_lectures,
        "present_count": present_count,
        "absent_count": absent_count,
        "attendance_percentage": attendance_percentage,
        "lectures": lectures_list
    }
@app.get("/attendance/defaulters")
def get_defaulters(threshold: float = 75.0):
    """
    Get list of students with overall attendance below the threshold (default 75%)
    """
    if threshold < 0 or threshold > 100:
        raise HTTPException(status_code=400, detail="Threshold must be between 0 and 100")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Query: For each student, calculate total lectures they should attend and how many they attended
    cursor.execute("""
        SELECT 
            s.student_id,
            s.name,
            COUNT(DISTINCT l.lecture_id) AS total_lectures,
            COUNT(DISTINCT a.lecture_id) AS present_lectures
        FROM students s
        JOIN enrollments e ON s.student_id = e.student_id
        LEFT JOIN lectures l ON l.standard_id = e.standard_id AND l.division_id = e.division_id AND (l.cancelled IS NULL OR l.cancelled = 0)
        LEFT JOIN attendance a ON a.student_id = s.student_id AND a.lecture_id = l.lecture_id
        GROUP BY s.student_id, s.name
        HAVING total_lectures > 0
    """)

    rows = cursor.fetchall()
    conn.close()

    defaulters = []
    for student_id, name, total, present in rows:
        if total == 0:
            continue
        percentage = (present / total) * 100
        if percentage < threshold:
            defaulters.append({
                "student_id": student_id,
                "student_name": name,
                "total_lectures": total,
                "present_lectures": present,
                "absent_lectures": total - present,
                "attendance_percentage": round(percentage, 2)
            })

    # Sort by lowest attendance first
    defaulters.sort(key=lambda x: x["attendance_percentage"])

    return {
        "threshold": threshold,
        "total_defaulters": len(defaulters),
        "defaulters": defaulters
    }
@app.get("/attendance/defaulters/subject/{subject}")
def get_defaulters_by_subject(
    subject: str,
    threshold: float = 75.0
):
    """
    Get defaulters for a specific subject (attendance < threshold)
    """
    if threshold < 0 or threshold > 100:
        raise HTTPException(status_code=400, detail="Threshold must be between 0 and 100")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT 
            s.student_id,
            s.name,
            COUNT(DISTINCT l.lecture_id) AS total_lectures,
            COUNT(DISTINCT a.lecture_id) AS present_lectures
        FROM students s
        JOIN enrollments e ON s.student_id = e.student_id
        JOIN lectures l ON l.standard_id = e.standard_id 
                       AND l.division_id = e.division_id
                       AND l.subject = ?
                       AND (l.cancelled IS NULL OR l.cancelled = 0)
        LEFT JOIN attendance a ON a.student_id = s.student_id 
                              AND a.lecture_id = l.lecture_id
        GROUP BY s.student_id, s.name
        HAVING total_lectures > 0
    """, (subject,))

    rows = cursor.fetchall()
    conn.close()

    defaulters = []
    for student_id, name, total, present in rows:
        percentage = (present / total) * 100 if total > 0 else 0
        if percentage < threshold:
            defaulters.append({
                "student_id": student_id,
                "student_name": name,
                "subject": subject,
                "total_lectures": total,
                "present_lectures": present,
                "absent_lectures": total - present,
                "attendance_percentage": round(percentage, 2)
            })

    defaulters.sort(key=lambda x: x["attendance_percentage"])

    return {
        "subject": subject,
        "threshold": threshold,
        "total_defaulters": len(defaulters),
        "defaulters": defaulters
    }


@app.get("/attendance/defaulters/range")
def get_defaulters_by_date_range(
    start: str,   # YYYY-MM-DD
    end: str,     # YYYY-MM-DD
    threshold: float = 75.0
):
    """
    Get defaulters whose overall attendance is < threshold between start and end dates
    """
    if threshold < 0 or threshold > 100:
        raise HTTPException(status_code=400, detail="Threshold must be between 0 and 100")

    try:
        datetime.strptime(start, "%Y-%m-%d")
        datetime.strptime(end, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must be in YYYY-MM-DD format")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT 
            s.student_id,
            s.name,
            COUNT(DISTINCT l.lecture_id) AS total_lectures,
            COUNT(DISTINCT a.lecture_id) AS present_lectures
        FROM students s
        JOIN enrollments e ON s.student_id = e.student_id
        JOIN lectures l ON l.standard_id = e.standard_id 
                       AND l.division_id = e.division_id
                       AND l.lecture_date BETWEEN ? AND ?
                       AND (l.cancelled IS NULL OR l.cancelled = 0)
        LEFT JOIN attendance a ON a.student_id = s.student_id 
                              AND a.lecture_id = l.lecture_id
        GROUP BY s.student_id, s.name
        HAVING total_lectures > 0
    """, (start, end))

    rows = cursor.fetchall()
    conn.close()

    defaulters = []
    for student_id, name, total, present in rows:
        percentage = (present / total) * 100 if total > 0 else 0
        if percentage < threshold:
            defaulters.append({
                "student_id": student_id,
                "student_name": name,
                "date_range": f"{start} to {end}",
                "total_lectures": total,
                "present_lectures": present,
                "absent_lectures": total - present,
                "attendance_percentage": round(percentage, 2)
            })

    defaulters.sort(key=lambda x: x["attendance_percentage"])

    return {
        "date_range": f"{start} to {end}",
        "threshold": threshold,
        "total_defaulters": len(defaulters),
        "defaulters": defaulters
    }


@app.post("/lecture-insights/save")
def save_lecture_insight(payload: dict):
    lecture_id = payload.get("lecture_id")
    lecture_name = payload.get("lecture_name")
    camera_id = payload.get("camera_id")
    transcript = payload.get("transcript") or ""
    lecture_summary = payload.get("lecture_summary") or ""
    key_topics = payload.get("key_topics") or []
    action_items = payload.get("action_items") or []
    overall_emotion = payload.get("overall_emotion") or ""
    emotion_timeline = payload.get("emotion_timeline") or []
    emotion_disclaimer = payload.get("emotion_disclaimer") or "Emotion analysis is an AI estimate and should be treated as advisory only."
    audio_base64 = payload.get("audio_base64")
    audio_mime = payload.get("audio_mime") or "audio/webm"

    audio_path = None
    if audio_base64:
        try:
            # Allow both plain base64 and data-uri format
            encoded = str(audio_base64)
            if "," in encoded and encoded.startswith("data:"):
                encoded = encoded.split(",", 1)[1]

            audio_bytes = base64.b64decode(encoded)
            ext_map = {
                "audio/webm": "webm",
                "audio/mp4": "mp4",
                "audio/mpeg": "mp3",
                "audio/wav": "wav",
            }
            extension = ext_map.get(str(audio_mime).lower(), "webm")
            filename = f"insight_{int(time.time() * 1000)}.{extension}"
            abs_path = os.path.abspath(os.path.join(INSIGHTS_AUDIO_DIR, filename))

            with open(abs_path, "wb") as f:
                f.write(audio_bytes)
            audio_path = abs_path
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid audio payload: {e}")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO lecture_voice_insights (
                lecture_id,
                lecture_name,
                camera_id,
                transcript,
                lecture_summary,
                key_topics_json,
                action_items_json,
                overall_emotion,
                emotion_timeline_json,
                emotion_disclaimer,
                audio_path,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            """,
            (
                lecture_id,
                lecture_name,
                camera_id,
                transcript,
                lecture_summary,
                json.dumps(key_topics),
                json.dumps(action_items),
                overall_emotion,
                json.dumps(emotion_timeline),
                emotion_disclaimer,
                audio_path,
            ),
        )
        conn.commit()
        insight_id = cursor.lastrowid
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"DB insert error: {e}")

    conn.close()

    return {
        "insight_id": insight_id,
        "audio_path": audio_path,
        "message": "Lecture insight saved",
    }


@app.get("/lecture-insights")
def list_lecture_insights(
    camera_id: Optional[str] = None,
    lecture: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    where = []
    params = []

    if camera_id:
        where.append("camera_id = ?")
        params.append(camera_id)
    if lecture:
        where.append("LOWER(COALESCE(lecture_name, '')) LIKE ?")
        params.append(f"%{lecture.strip().lower()}%")
    if start_date:
        where.append("date(created_at) >= date(?)")
        params.append(start_date)
    if end_date:
        where.append("date(created_at) <= date(?)")
        params.append(end_date)

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    query = f"""
        SELECT
            insight_id,
            lecture_id,
            lecture_name,
            camera_id,
            transcript,
            lecture_summary,
            key_topics_json,
            action_items_json,
            overall_emotion,
            emotion_timeline_json,
            emotion_disclaimer,
            audio_path,
            created_at
        FROM lecture_voice_insights
        {where_sql}
        ORDER BY datetime(created_at) DESC, insight_id DESC
    """

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    items = []
    for row in rows:
        (
            insight_id,
            lecture_id,
            lecture_name,
            camera_id_row,
            transcript,
            lecture_summary,
            key_topics_json,
            action_items_json,
            overall_emotion,
            emotion_timeline_json,
            emotion_disclaimer,
            audio_path,
            created_at,
        ) = row

        try:
            key_topics = json.loads(key_topics_json) if key_topics_json else []
        except Exception:
            key_topics = []
        try:
            action_items = json.loads(action_items_json) if action_items_json else []
        except Exception:
            action_items = []
        try:
            emotion_timeline = json.loads(emotion_timeline_json) if emotion_timeline_json else []
        except Exception:
            emotion_timeline = []

        items.append(
            {
                "insight_id": insight_id,
                "lecture_id": lecture_id,
                "lecture_name": lecture_name,
                "camera_id": camera_id_row,
                "transcript": transcript,
                "lecture_summary": lecture_summary,
                "key_topics": key_topics,
                "action_items": action_items,
                "overall_emotion": overall_emotion,
                "emotion_timeline": emotion_timeline,
                "emotion_disclaimer": emotion_disclaimer,
                "audio_path": audio_path,
                "created_at": created_at,
            }
        )

    return {"total": len(items), "items": items}


@app.get("/lecture-insights/{insight_id}/audio")
def download_insight_audio(insight_id: int):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT audio_path FROM lecture_voice_insights WHERE insight_id = ?", (insight_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Insight not found")

    audio_path = row[0]
    if not audio_path:
        raise HTTPException(status_code=404, detail="No audio file found for this insight")
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file missing on server")

    return FileResponse(path=audio_path, filename=os.path.basename(audio_path), media_type="application/octet-stream")


@app.get("/lecture-insights/{insight_id}/summary")
def download_insight_summary(insight_id: int):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT
            lecture_name,
            lecture_summary,
            key_topics_json,
            action_items_json,
            overall_emotion,
            emotion_timeline_json,
            transcript,
            emotion_disclaimer,
            created_at
        FROM lecture_voice_insights
        WHERE insight_id = ?
        """,
        (insight_id,),
    )
    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Insight not found")

    (
        lecture_name,
        lecture_summary,
        key_topics_json,
        action_items_json,
        overall_emotion,
        emotion_timeline_json,
        transcript,
        emotion_disclaimer,
        created_at,
    ) = row

    try:
        key_topics = json.loads(key_topics_json) if key_topics_json else []
    except Exception:
        key_topics = []
    try:
        action_items = json.loads(action_items_json) if action_items_json else []
    except Exception:
        action_items = []
    try:
        emotion_timeline = json.loads(emotion_timeline_json) if emotion_timeline_json else []
    except Exception:
        emotion_timeline = []

    content = "\n".join(
        [
            f"Insight ID: {insight_id}",
            f"Lecture: {lecture_name or 'N/A'}",
            f"Created At: {created_at}",
            "",
            "Lecture Summary",
            lecture_summary or "N/A",
            "",
            "Key Topics",
            "\n".join(key_topics) if key_topics else "N/A",
            "",
            "Action Items",
            "\n".join(action_items) if action_items else "N/A",
            "",
            "Overall Emotion",
            overall_emotion or "N/A",
            "",
            "Emotion Timeline",
            "\n".join(emotion_timeline) if emotion_timeline else "N/A",
            "",
            "Transcript",
            transcript or "N/A",
            "",
            emotion_disclaimer or "",
        ]
    )

    filename = f"lecture_insight_{insight_id}.txt"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}
    return Response(content=content, media_type="text/plain", headers=headers)


# ================= STUDENT EMOTIONS ENDPOINTS =================
@app.get("/student-emotions/lecture/{lecture_id}")
def get_lecture_emotions(
    lecture_id: int,
    camera_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
):
    """
    Get all emotion detections for a specific lecture.
    Optionally filter by camera_id.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    query = "SELECT * FROM student_emotions WHERE lecture_id = ?"
    params = [lecture_id]
    
    if camera_id:
        query += " AND camera_id = ?"
        params.append(camera_id)
    
    query += f" ORDER BY detected_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    
    # Get column names
    cursor.execute("PRAGMA table_info(student_emotions)")
    columns = [col[1] for col in cursor.fetchall()]
    
    conn.close()
    
    emotions = []
    for row in rows:
        emotions.append(dict(zip(columns, row)))
    
    return {
        "total": len(emotions),
        "items": emotions,
        "limit": limit,
        "offset": offset
    }


@app.get("/student-emotions/summaries/lecture/{lecture_id}")
def get_emotion_summaries(
    lecture_id: int,
    camera_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
):
    """
    Get aggregated emotion summaries for a lecture.
    Shows emotion distribution per sampling period.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    query = "SELECT * FROM student_emotion_summaries WHERE lecture_id = ?"
    params = [lecture_id]
    
    if camera_id:
        query += " AND camera_id = ?"
        params.append(camera_id)
    
    query += f" ORDER BY sampling_time DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    
    # Get column names
    cursor.execute("PRAGMA table_info(student_emotion_summaries)")
    columns = [col[1] for col in cursor.fetchall()]
    
    conn.close()
    
    summaries = []
    for row in rows:
        item = dict(zip(columns, row))
        # Parse JSON fields
        if item.get('emotion_distribution'):
            try:
                item['emotion_distribution'] = json.loads(item['emotion_distribution'])
            except:
                pass
        summaries.append(item)
    
    return {
        "total": len(summaries),
        "items": summaries,
        "limit": limit,
        "offset": offset
    }


@app.get("/student-emotions/statistics/lecture/{lecture_id}")
def get_emotion_statistics(lecture_id: int):
    """
    Get overall emotion statistics for a lecture.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Overall emotion distribution
    cursor.execute("""
        SELECT emotion, COUNT(*) as count
        FROM student_emotions
        WHERE lecture_id = ?
        GROUP BY emotion
        ORDER BY count DESC
    """, (lecture_id,))
    
    emotion_dist = {}
    total_emotions = 0
    for emotion, count in cursor.fetchall():
        emotion_dist[emotion] = count
        total_emotions += count
    
    # Average confidence per emotion
    cursor.execute("""
        SELECT emotion, AVG(confidence) as avg_conf
        FROM student_emotions
        WHERE lecture_id = ?
        GROUP BY emotion
    """, (lecture_id,))
    
    avg_confidence = {}
    for emotion, avg_conf in cursor.fetchall():
        avg_confidence[emotion] = round(avg_conf, 4)
    
    # Known vs Unknown student detection count
    cursor.execute("""
        SELECT is_known_student, COUNT(*) as count
        FROM student_emotions
        WHERE lecture_id = ?
        GROUP BY is_known_student
    """, (lecture_id,))
    
    known_unknown = {}
    for is_known, count in cursor.fetchall():
        known_unknown["known" if is_known else "unknown"] = count
    
    # Dominant emotion overall
    dominant = max(emotion_dist, key=emotion_dist.get) if emotion_dist else "unknown"
    
    conn.close()
    
    return {
        "lecture_id": lecture_id,
        "total_detections": total_emotions,
        "emotion_distribution": emotion_dist,
        "dominant_emotion": dominant,
        "average_confidence_per_emotion": avg_confidence,
        "known_vs_unknown_students": known_unknown,
        "percentage_known": round(
            (known_unknown.get("known", 0) / total_emotions * 100) if total_emotions > 0 else 0,
            2
        )
    }
