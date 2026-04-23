-- ===============================
-- STUDENTS (Permanent Identity)
-- ===============================
CREATE TABLE IF NOT EXISTS students (
    student_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    embedding BLOB NOT NULL
);

-- ===============================
-- STANDARDS (FY, SY, TY)
-- ===============================
CREATE TABLE IF NOT EXISTS standards (
    standard_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

-- ===============================
-- DIVISIONS (A, B, C)
-- ===============================
CREATE TABLE IF NOT EXISTS divisions (
    division_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

-- ===============================
-- ENROLLMENTS (Year-wise mapping)
-- ===============================
CREATE TABLE IF NOT EXISTS enrollments (
    enrollment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    academic_year TEXT,
    standard_id INTEGER,
    division_id INTEGER,

    FOREIGN KEY(student_id) REFERENCES students(student_id),
    FOREIGN KEY(standard_id) REFERENCES standards(standard_id),
    FOREIGN KEY(division_id) REFERENCES divisions(division_id)
);

-- ===============================
-- LECTURES
-- ===============================
CREATE TABLE IF NOT EXISTS lectures (
    lecture_id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT,
    academic_year TEXT,
    standard_id INTEGER,
    division_id INTEGER,
    classroom TEXT,
    start_time TEXT,
    end_time TEXT
, lecture_date DATE);

-- ===============================
-- ATTENDANCE
-- ===============================
CREATE TABLE IF NOT EXISTS "attendance" (
    attendance_id INTEGER PRIMARY KEY AUTOINCREMENT,
    lecture_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    marked_at TEXT NOT NULL,
    camera_id TEXT,
    UNIQUE (lecture_id, student_id)
);

-- ===============================
-- LECTURE VOICE INSIGHTS
-- ===============================
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
);

-- ===============================
-- STUDENT EMOTIONS
-- ===============================
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
);

-- ===============================
-- STUDENT EMOTION SUMMARIES (Per-Lecture Aggregation)
-- ===============================
CREATE TABLE IF NOT EXISTS student_emotion_summaries (
    summary_id INTEGER PRIMARY KEY AUTOINCREMENT,
    lecture_id INTEGER NOT NULL,
    camera_id TEXT NOT NULL,
    sampling_time TEXT NOT NULL,
    total_students_detected INTEGER,
    emotion_distribution JSON,
    dominant_emotion TEXT,
    avg_confidence REAL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE (lecture_id, camera_id, sampling_time),
    FOREIGN KEY (lecture_id) REFERENCES lectures(lecture_id)
);