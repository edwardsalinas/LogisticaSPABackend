import zlib
import base64
import string
import urllib.request

def plantuml_encode(plantuml_text):
    zlibbed_str = zlib.compress(plantuml_text.encode('utf-8'))
    compressed_string = zlibbed_str[2:-4]
    
    plantuml_alphabet = string.digits + string.ascii_uppercase + string.ascii_lowercase + '-_'
    base64_alphabet   = string.ascii_uppercase + string.ascii_lowercase + string.digits + '+/'
    b64_to_plantuml = str.maketrans(base64_alphabet, plantuml_alphabet)
    
    return base64.b64encode(compressed_string).decode('utf-8').translate(b64_to_plantuml)

test_puml = """
@startuml
title Arquitectura
class "Testing" as T
@enduml
"""

def run_test():
    encoded = plantuml_encode(test_puml)
    url = f"http://www.plantuml.com/plantuml/png/{encoded}"
    print(f"URL: {url}")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as res, open("test_plantuml_fixed.png", 'wb') as f:
            f.write(res.read())
        print("Success! Image generated.")
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    run_test()
