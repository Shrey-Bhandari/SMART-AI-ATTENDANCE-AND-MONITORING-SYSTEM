import sqlite3

DB_PATH = "attendance.db"

def create_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    with open("schema.sql", "r") as f:
        cursor.executescript(f.read())

    conn.commit()
    conn.close()
    print("✅ Database & tables created successfully")

if __name__ == "__main__":
    create_db()
