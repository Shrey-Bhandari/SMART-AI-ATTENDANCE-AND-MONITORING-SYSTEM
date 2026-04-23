import { config } from 'dotenv';
config();

import '@/ai/flows/live-camera-face-recognition.ts';
import '@/ai/flows/lecture-info-auto-population.ts';
import '@/ai/flows/dashboard-summary-generator.ts';
import '@/ai/flows/lecture-voice-summary.ts';