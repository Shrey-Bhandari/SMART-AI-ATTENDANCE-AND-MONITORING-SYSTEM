import sqlite3
import random
import pickle
from face_utils import serialize_embedding

DB_PATH = "attendance.db"
ACADEMIC_YEAR = "2024-25"

with open("embeddings/face_embeddings.pkl", "rb") as f:
    embeddings = pickle.load(f)

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

cursor.execute("SELECT standard_id FROM standards")
standards = cursor.fetchall()

cursor.execute("SELECT division_id FROM divisions")
divisions = cursor.fetchall()

for name, emb in embeddings.items():
    emb_blob = serialize_embedding(emb)

    cursor.execute(
        "INSERT OR IGNORE INTO students (name, embedding) VALUES (?, ?)",
        (name, emb_blob)
    )

    cursor.execute("SELECT student_id FROM students WHERE name=?", (name,))
    student_id = cursor.fetchone()[0]

    std_id = random.choice(standards)[0]
    div_id = random.choice(divisions)[0]

    cursor.execute("""
        INSERT INTO enrollments (student_id, academic_year, standard_id, division_id)
        VALUES (?, ?, ?, ?)
    """, (student_id, ACADEMIC_YEAR, std_id, div_id))

conn.commit()
conn.close()

print("✅ LFW students imported with divisions")
