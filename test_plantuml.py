import base64
import zlib
import urllib.request

wae_puml_visual = """
@startuml
title Test
class "Test" as T
@enduml
"""

def test_encode():
    compressed = zlib.compress(wae_puml_visual.encode('utf-8'))
    b64_str = base64.urlsafe_b64encode(compressed).decode('utf-8')
    # PlantUML standard deflate + base64url needs ~1 header
    url = f"http://www.plantuml.com/plantuml/png/~1{b64_str}"
    print(url)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as res, open("test.png", 'wb') as f:
            f.write(res.read())
        print("Test passed")
    except Exception as e:
        print("Test failed:", e)

if __name__ == "__main__":
    test_encode()
