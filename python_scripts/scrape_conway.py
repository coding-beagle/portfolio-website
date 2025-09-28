import os
import json

LOCAL_DIR = "app/public/cells"
MANIFEST_PATH = os.path.join(LOCAL_DIR, "manifest.json")


def parse_cells_metadata(text):
    name = None
    author = None
    description_lines = []
    lines = text.splitlines()
    for idx, line in enumerate(lines):
        if not line.startswith("!"):
            break
        content = line[1:].strip()
        if not content:
            continue
        if idx == 0:
            name = content
            continue
        if idx == 1:
            author = content
            continue
        description_lines.append(content)
    if description_lines and name in description_lines[0]:
        description_lines = description_lines[1:]
    description = " ".join(description_lines).strip()
    return name, author, description


def main():
    os.makedirs(LOCAL_DIR, exist_ok=True)
    manifest = []
    for filename in os.listdir(LOCAL_DIR):
        if filename.endswith(".cells"):
            path = os.path.join(LOCAL_DIR, filename)
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
            name, author, description = parse_cells_metadata(text)
            manifest.append(
                {
                    "filename": filename,
                    "name": name or filename,
                    "author": author or "",
                    "description": description or "",
                }
            )
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"Manifest written to {MANIFEST_PATH} with {len(manifest)} patterns.")


if __name__ == "__main__":
    main()
