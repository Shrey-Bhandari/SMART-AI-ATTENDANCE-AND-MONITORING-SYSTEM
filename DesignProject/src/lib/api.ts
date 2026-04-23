import { LectureCreate } from "./schemas";
import type { Lecture, Student, LectureInsight } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

async function fetchAPI(path: string, options: RequestInit = {}) {
  const url = `${API_URL}${path}`;
  try {
    const response = await fetch(url, { ...options, cache: 'no-store' });
    if (!response.ok) {
      // Try to parse JSON error body (FastAPI returns { detail: ... })
      let errorText = '';
      try {
        const errJson = await response.json();
        errorText = errJson?.detail || errJson?.message || JSON.stringify(errJson);
      } catch (_err) {
        try {
          errorText = await response.text();
        } catch (_e) {
          errorText = `HTTP ${response.status}`;
        }
      }
      throw new Error(errorText || `Request failed with status ${response.status}`);
    }
    return response.json();
  } catch (error) {
    throw new Error(`Network error when fetching ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Lectures
export const getLectures = (): Promise<Lecture[]> => fetchAPI('/lectures/all');
export const createLecture = (lecture: LectureCreate) => fetchAPI('/lectures', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(lecture)
});
// Update a lecture
export const updateLecture = async (lectureId: number | string, lecture: LectureCreate) => {
  // Try common variants: PUT then PATCH, and with/without trailing slash.
  const paths = [`/lectures/${lectureId}`, `/lectures/${lectureId}/`];
  const methods: ('PUT' | 'PATCH')[] = ['PUT', 'PATCH'];
  let lastError: any = null;
  for (const path of paths) {
    for (const method of methods) {
      try {
        return await fetchAPI(path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lecture),
        });
      } catch (err) {
        lastError = err;
        // continue trying other variants
      }
    }
  }
  throw lastError || new Error('Failed to update lecture');
};

// Delete / cancel a lecture
export const deleteLecture = (lectureId: number | string) => fetchAPI(`/lectures/${lectureId}`, {
  method: 'DELETE'
});

// Students
export const getStudents = (): Promise<Student[]> => fetchAPI('/students/all');
export const getStudentSummary = (studentId: number | string) => fetchAPI(`/attendance/student/${studentId}/summary`);

// Attendance
export const startAttendance = (cameraId: string) => fetchAPI(`/attendance/start/${cameraId}`, { method: 'POST' });
export const stopAttendance = (cameraId: string) => fetchAPI(`/attendance/stop/${cameraId}`, { method: 'POST' });
export const disableAutoAttendance = (cameraId: string) => fetchAPI(`/attendance/disable_auto/${cameraId}`, { method: 'POST' });
export const getAttendanceForLecture = (lectureId: number | string) => fetchAPI(`/attendance/lecture/${lectureId}`);
export const getAttendanceStats = (lectureId: number | string) => fetchAPI(`/attendance/stats/${lectureId}`);
export const markAttendance = (lectureId: number | string, studentId: number | string, cameraId?: string) => fetchAPI('/attendance/mark', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ lecture_id: lectureId, student_id: studentId, camera_id: cameraId })
});

export const unmarkAttendance = (lectureId: number | string, studentId: number | string) => fetchAPI('/attendance/unmark', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ lecture_id: lectureId, student_id: studentId })
});

// Defaulters
export const getOverallDefaulters = (threshold: number) => fetchAPI(`/attendance/defaulters?threshold=${threshold}`);
export const getSubjectDefaulters = (subject: string, threshold: number) => fetchAPI(`/attendance/defaulters/subject/${subject}?threshold=${threshold}`);
export const getDateRangeDefaulters = (start: string, end: string, threshold: number) => fetchAPI(`/attendance/defaulters/range?start=${start}&end=${end}&threshold=${threshold}`);

// Cameras & System Status
export const getCameras = (): Promise<{ cameras: string[] }> => fetchAPI('/cameras');
export const getCameraStatus = (cameraId: string) => fetchAPI(`/status/${cameraId}`);
export const getDashboardKPIs = () => fetchAPI('/dashboard/kpis');

// Lecture Insights
export const getLectureInsights = (params?: {
  cameraId?: string;
  lecture?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ total: number; items: LectureInsight[] }> => {
  const search = new URLSearchParams();
  if (params?.cameraId) search.set('camera_id', params.cameraId);
  if (params?.lecture) search.set('lecture', params.lecture);
  if (params?.startDate) search.set('start_date', params.startDate);
  if (params?.endDate) search.set('end_date', params.endDate);
  const qs = search.toString();
  return fetchAPI(`/lecture-insights${qs ? `?${qs}` : ''}`);
};

export const getLectureInsightAudioUrl = (insightId: number | string) => `${API_URL}/lecture-insights/${insightId}/audio`;
export const getLectureInsightSummaryUrl = (insightId: number | string) => `${API_URL}/lecture-insights/${insightId}/summary`;