# SMART AI Attendance and Monitoring System

A full-stack attendance system with face recognition, lecture insights, and a modern Next.js dashboard.

## Overview

This repo combines:

- A Python backend for real-time face attendance, emotion tracking, and lecture audio/insight capture
- A SQLite database schema for students, lectures, attendance, emotion summaries, and voice insights
- A Next.js frontend inside `DesignProject/` for dashboard, lecture, and attendance management
- Support for embeddings storage in `embeddings/`

## Features

- Multi-camera face attendance tracking
- Student enrollment and face embedding management
- Lecture attendance logs stored in `attendance_logs/`
- Voice and emotion insight support for lectures
- Database initialization from `schema.sql`
- Next.js UI for attendance, lectures, analytics, and system monitoring

## Repository Structure

- `main.py` - FastAPI backend and camera/attendance orchestration
- `face_utils.py` - Face embedding utilities and helper functions
- `import_lfw_students.py` - Student import helpers using LFW datasets
- `init_db.py` - Creates `attendance.db` using `schema.sql`
- `schema.sql` - Database schema definitions
- `attendance_logs/` - Stored lecture attendance CSV logs
- `embeddings/` - Face embeddings folder (now allowed in `.gitignore`)
- `DesignProject/` - Next.js frontend application

## Setup

### Python backend

1. Create and activate a virtual environment:

```bash
python -m venv .venv
.\.venv\Scripts\activate
```

2. Install backend dependencies:

```bash
pip install fastapi uvicorn opencv-python pandas numpy scipy keras-facenet deepface ultralytics
```

3. Initialize the database:

```bash
python init_db.py
```

4. Start the backend server:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

1. Open the frontend folder:

```bash
cd DesignProject
```

2. Install dependencies:

```bash
npm install
```

3. Start the development server:

```bash
npm run dev
```

4. Open the app in your browser, usually at `http://localhost:9002`

## Notes

- The `embeddings/` folder is explicitly allowed in `.gitignore`, so embeddings can be committed and pushed to GitHub.
- Git does not track empty folders; ensure `embeddings/` contains files before committing.
- The backend uses `yolov8n-face.pt` for face detection and expects the model file in the repository root.

## Important Files

- `init_db.py` — creates the SQLite database from `schema.sql`
- `schema.sql` — database tables for students, lectures, attendance, and insights
- `main.py` — FastAPI application and attendance flow
- `DesignProject/package.json` — frontend dependencies and scripts

## Getting Help

- Check `attendance_logs/` for saved attendance CSV files
- Use `DesignProject/src/app` for frontend pages and UI flows
- Update `.gitignore` if you need to allow additional local folders
