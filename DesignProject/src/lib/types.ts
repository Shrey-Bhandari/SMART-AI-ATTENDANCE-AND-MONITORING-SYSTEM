export type Student = {
  id: string | number;
  name: string;
  standard: string;
  division: string;
  avatarUrl: string;
  overallAttendance: number;
  presentCount: number;
  absentCount: number;
};

export type Lecture = {
  id: string | number;
  subject: string;
  date: string;
  startTime: string;
  endTime: string;
  academicYear: string;
  standard: string;
  division: string;
  classRoom: string;
  cancelled?: boolean;
};

export type AttendanceRecord = {
  studentId: string;
  studentName: string;
  status: 'Present' | 'Absent' | 'Cancelled';
  markedTime?: string;
  cameraId?: string;
};

export type Camera = {
  id: string;
  status: 'Active' | 'Offline' | 'loading';
  currentLecture?: string;
  attendanceActive: boolean;
  markedCount: number;
};

export type LectureInsight = {
  insight_id: number;
  lecture_id?: number | null;
  lecture_name?: string | null;
  camera_id?: string | null;
  transcript: string;
  lecture_summary: string;
  key_topics: string[];
  action_items: string[];
  overall_emotion?: string | null;
  emotion_timeline: string[];
  emotion_disclaimer?: string | null;
  audio_path?: string | null;
  created_at: string;
};
