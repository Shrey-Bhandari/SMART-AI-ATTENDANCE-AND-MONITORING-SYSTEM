import sqlite3

DB_PATH = "attendance.db"

standards = ["FY", "SY", "TY"]
divisions = ["A", "B", "C"]

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

for s in standards:
    cursor.execute("INSERT OR IGNORE INTO standards (name) VALUES (?)", (s,))

for d in divisions:
    cursor.execute("INSERT OR IGNORE INTO divisions (name) VALUES (?)", (d,))

conn.commit()
conn.close()

print("✅ Standards & divisions inserted")
