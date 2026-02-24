from docx import Document

def read_cover_page(filename):
    print(f"Reading {filename}...")
    try:
        doc = Document(filename)
        print("--- CONTENT START ---")
        line_count = 0
        for i, para in enumerate(doc.paragraphs):
            # Leer más párrafos para asegurar capturar toda la carátula
            if line_count > 50: break 
            text = para.text.strip()
            if text:
                print(f"[{i}] {text}")
                line_count += 1
        print("--- CONTENT END ---")
    except Exception as e:
        print(f"Error reading file: {e}")

if __name__ == "__main__":
    read_cover_page("Jorge Siles Zepita.docx")
