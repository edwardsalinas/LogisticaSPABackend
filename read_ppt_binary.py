import re

def extract_strings_from_binary(filename, min_length=4):
    print(f"Extracting strings from {filename}...")
    try:
        with open(filename, "rb") as f:
            content = f.read()
            # Simple regex to find readable ascii strings
            strings = re.findall(b"[a-zA-Z0-9\s\.\,\:\-\(\)]{" + str(min_length).encode() + b",}", content)
            
            print("--- CONTENT START ---")
            for s in strings:
                try:
                    # Decode and print if it looks like meaningful text
                    text = s.decode("utf-8", errors="ignore").strip()
                    if len(text) > 10: # Only print substantial text
                        print(text)
                except:
                    pass
            print("--- CONTENT END ---")
    except Exception as e:
        print(f"Error reading file: {e}")

if __name__ == "__main__":
    extract_strings_from_binary("Copia de SMART Goals.ppt")
