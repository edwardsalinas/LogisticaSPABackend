from pypdf import PdfReader

def extract_text_from_pdf(filename):
    print(f"Extracting text from {filename}...")
    try:
        reader = PdfReader(filename)
        for i, page in enumerate(reader.pages):
            print(f"--- Page {i+1} ---")
            print(page.extract_text())
    except Exception as e:
        print(f"Error extracting text: {e}")

if __name__ == "__main__":
    extract_text_from_pdf("Copia de SMART Goals.ppt.pdf")
